package main

import (
	"embed"
	"fmt"
	"log"
	"net"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var appIcon []byte

func init() {
	// Deployment limitation: WebKitGTK's bubblewrap (bwrap) sandbox cannot run on systems
	// where the kernel AppArmor policy restricts unprivileged user namespaces
	// (kernel.apparmor_restrict_unprivileged_userns = 1), which is the default on Ubuntu 24.04+.
	// Attempting to use bwrap on these systems fails with:
	//   "bwrap: setting up uid map: Permission denied"
	// followed by a SIGTRAP crash (exit status 2).
	//
	// This cannot be fixed in user-space without either:
	//   (a) a privileged helper (suid bwrap), or
	//   (b) relaxing the kernel AppArmor policy (sysctl kernel.apparmor_restrict_unprivileged_userns=0).
	//
	// Neither option is appropriate for this application, so the WebKit sandbox is disabled.
	// This is an explicit, acknowledged deployment limitation, not an oversight.
	// The application only renders its own bundled assets and does not load untrusted web content,
	// which substantially reduces the practical risk of running without the renderer sandbox.
	if _, ok := os.LookupEnv("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS"); !ok {
		os.Setenv("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1")
	}
}

func main() {
	// Create the application service (business logic).
	svc := NewAppService()

	// Single-instance lock via Unix domain socket.
	lockPath := singleInstanceLockPath()
	ln, err := acquireSingleInstance(lockPath, svc.ShowWindow)
	if err != nil {
		// Another instance is running — signal it to come to the foreground.
		signalExistingInstance(lockPath)
		os.Exit(0)
	}
	defer func() {
		if ln != nil {
			ln.Close()
		}
		os.Remove(lockPath)
	}()

	app := application.New(application.Options{
		Name:        "TimeCheck",
		Description: "Check-in/check-out work schedule reminder",
		Assets: application.AssetOptions{
			Handler: application.BundledAssetFileServer(assets),
		},
		Services: []application.Service{
			application.NewService(svc),
		},
		OnShutdown: svc.Shutdown,
		Linux: application.LinuxOptions{
			// Keep the app alive when windows are closed.
			DisableQuitOnLastWindowClosed: true,
			ProgramName:                   "timecheck",
		},
	})

	// ── Window 1: Main App Window (Maximised) ───────────────────────────────
	mainWin := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "TimeCheck",
		Name:             "main",
		Width:            1024,
		Height:           768,
		MinWidth:         600,
		MinHeight:        400,
		StartState:       application.WindowStateMaximised,
		Hidden:           true,
		HideOnEscape:     true,
		URL:              "/",
		BackgroundColour: application.NewRGBA(15, 23, 42, 255),
	})
	mainWin.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		mainWin.Hide()
		e.Cancel()
	})

	// ── Window 2: Logout / Check-Out Dialog Window (Maximised) ──────────────
	checkoutWin := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "TimeCheck - Check Out",
		Name:             "checkout",
		Width:            1024,
		Height:           768,
		MinWidth:         600,
		MinHeight:        400,
		StartState:       application.WindowStateMaximised,
		AlwaysOnTop:      true,
		Hidden:           true,
		HideOnEscape:     true,
		URL:              "/?window=checkout",
		BackgroundColour: application.NewRGBA(15, 23, 42, 255),
	})
	checkoutWin.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		svc.ShutdownCancel()
		checkoutWin.Hide()
		e.Cancel()
	})

	// Give the service references to both windows.
	svc.SetWindows(mainWin, checkoutWin)

	// ── System Tray ─────────────────────────────────────────────────────────
	tray := app.SystemTray.New()
	tray.SetIcon(appIcon)
	tray.SetTooltip("TimeCheck")

	menu := app.NewMenu()
	menu.Add("TimeCheck").SetEnabled(false)
	menu.AddSeparator()
	menu.Add("Open App").OnClick(func(ctx *application.Context) {
		svc.ShowWindow()
	})
	menu.AddSeparator()
	menu.Add("Quit").OnClick(func(ctx *application.Context) {
		app.Quit()
	})
	tray.SetMenu(menu)

	// ── Start background services ────────────────────────────────────────────

	if err := svc.Startup(app); err != nil {
		log.Fatalf("startup: %v", err)
	}

	if err := app.Run(); err != nil {
		log.Fatalf("wails: %v", err)
	}
}

// singleInstanceLockPath returns the Unix socket path for single-instance locking.
func singleInstanceLockPath() string {
	runDir := os.Getenv("XDG_RUNTIME_DIR")
	if runDir != "" {
		return filepath.Join(runDir, "timecheck.sock")
	}
	// Fallback to a user-private directory in /tmp with mode 0700 to prevent symlink attacks
	tmpUserDir := filepath.Join(os.TempDir(), fmt.Sprintf("timecheck-runtime-%d", os.Getuid()))
	_ = os.MkdirAll(tmpUserDir, 0700)
	_ = os.Chmod(tmpUserDir, 0700)
	return filepath.Join(tmpUserDir, "timecheck.sock")
}

// acquireSingleInstance attempts to listen on the lock socket atomically.
// Returns a net.Listener if successful (first instance), or an error if another instance is active.
func acquireSingleInstance(sockPath string, onRaise func()) (net.Listener, error) {
	ln, err := net.Listen("unix", sockPath)
	if err == nil {
		_ = os.Chmod(sockPath, 0600)
		startSingleInstanceServer(ln, onRaise)
		return ln, nil
	}

	// If listen failed, verify if another instance is actually alive
	conn, dialErr := net.Dial("unix", sockPath)
	if dialErr == nil {
		conn.Close()
		return nil, fmt.Errorf("another instance is running")
	}

	// If dial failed (e.g. connection refused), the socket is stale.
	// Note: Lstat + Remove is not fully atomic, but the socket is in a user-private
	// runtime directory (mode 0700), which substantially reduces symlink-race risk.
	if fi, statErr := os.Lstat(sockPath); statErr == nil {
		if fi.Mode().Type() != os.ModeSocket {
			return nil, fmt.Errorf(
				"unsafe existing lock file at %s: mode %v",
				sockPath,
				fi.Mode(),
			)
		}

		if err := os.Remove(sockPath); err != nil {
			return nil, fmt.Errorf("remove stale socket: %w", err)
		}
	}

	// Try listening again after removing stale socket
	ln, err = net.Listen("unix", sockPath)
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}
	_ = os.Chmod(sockPath, 0600)
	startSingleInstanceServer(ln, onRaise)
	return ln, nil
}

func startSingleInstanceServer(ln net.Listener, onRaise func()) {
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			buf := make([]byte, 32)
			n, _ := conn.Read(buf)
			conn.Close()
			if string(buf[:n]) == "raise" {
				log.Println("single-instance: raise requested")
				if onRaise != nil {
					onRaise()
				}
			}
		}
	}()
}

// signalExistingInstance sends a "raise" command to the running instance.
func signalExistingInstance(sockPath string) {
	conn, err := net.Dial("unix", sockPath)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.Write([]byte("raise")) //nolint:errcheck
}
