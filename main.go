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
	// WebKitGTK sandboxing (bubblewrap/bwrap) fails on Linux distros (e.g. Ubuntu 24.04+)
	// where unprivileged user namespaces are restricted by AppArmor, causing:
	// "bwrap: setting up uid map: Permission denied" and SIGTRAP crash (exit status 2).
	// Setting WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 ensures reliable execution.
	if _, ok := os.LookupEnv("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS"); !ok {
		os.Setenv("WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS", "1")
	}
}

func main() {
	// Create the application service (business logic).
	svc := NewAppService()

	// Single-instance lock via Unix domain socket.
	lockPath := singleInstanceLockPath()
	if err := acquireSingleInstance(lockPath, svc.ShowSettingsWindow); err != nil {
		// Another instance is running — signal it to come to the foreground.
		signalExistingInstance(lockPath)
		os.Exit(0)
	}

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

	// ── Single Main Window (Always Fullscreen) ──────────────────────────────
	mainWin := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "TimeCheck",
		Name:             "main",
		StartState:       application.WindowStateFullscreen,
		Hidden:           true,
		HideOnEscape:     true,
		URL:              "/",
		BackgroundColour: application.NewRGBA(15, 23, 42, 255),
	})
	mainWin.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		svc.CancelIfCheckingOut()
		mainWin.Hide()
		e.Cancel()
	})

	// Give the service reference to the single window.
	svc.setWindow(mainWin)

	// ── System Tray ─────────────────────────────────────────────────────────
	tray := app.SystemTray.New()
	tray.SetIcon(appIcon)
	tray.SetTooltip("TimeCheck")

	menu := app.NewMenu()
	menu.Add("TimeCheck").SetEnabled(false)
	menu.AddSeparator()
	menu.Add("Open TimeCheck").OnClick(func(ctx *application.Context) {
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
	return filepath.Join(os.TempDir(), fmt.Sprintf("timecheck-%d.sock", os.Getuid()))
}

// acquireSingleInstance tries to listen on the lock socket.
// Returns nil if this is the first instance, error otherwise.
func acquireSingleInstance(sockPath string, onRaise func()) error {
	if _, err := os.Stat(sockPath); err == nil {
		conn, err := net.Dial("unix", sockPath)
		if err == nil {
			conn.Close()
			return fmt.Errorf("another instance is running")
		}
		os.Remove(sockPath)
	}
	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
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
	return nil
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
