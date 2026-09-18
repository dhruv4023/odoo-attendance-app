export namespace attendance {
	
	export class DailyStatus {
	    date: string;
	    checked_in: boolean;
	    // Go type: time
	    check_in_at?: any;
	    checked_out: boolean;
	    // Go type: time
	    check_out_at?: any;
	
	    static createFrom(source: any = {}) {
	        return new DailyStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.checked_in = source["checked_in"];
	        this.check_in_at = this.convertValues(source["check_in_at"], null);
	        this.checked_out = source["checked_out"];
	        this.check_out_at = this.convertValues(source["check_out_at"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class CheckResult {
	    ok: boolean;
	    message?: string;
	
	    static createFrom(source: any = {}) {
	        return new CheckResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.message = source["message"];
	    }
	}

}

export namespace schedule {
	
	export class DaySchedule {
	    enabled: boolean;
	    check_in: string;
	    check_out: string;
	
	    static createFrom(source: any = {}) {
	        return new DaySchedule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.check_in = source["check_in"];
	        this.check_out = source["check_out"];
	    }
	}
	export class Schedule {
	    monday: DaySchedule;
	    tuesday: DaySchedule;
	    wednesday: DaySchedule;
	    thursday: DaySchedule;
	    friday: DaySchedule;
	    saturday: DaySchedule;
	    sunday: DaySchedule;
	
	    static createFrom(source: any = {}) {
	        return new Schedule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.monday = this.convertValues(source["monday"], DaySchedule);
	        this.tuesday = this.convertValues(source["tuesday"], DaySchedule);
	        this.wednesday = this.convertValues(source["wednesday"], DaySchedule);
	        this.thursday = this.convertValues(source["thursday"], DaySchedule);
	        this.friday = this.convertValues(source["friday"], DaySchedule);
	        this.saturday = this.convertValues(source["saturday"], DaySchedule);
	        this.sunday = this.convertValues(source["sunday"], DaySchedule);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class URLs {
	    check_in: string;
	    check_out: string;
	
	    static createFrom(source: any = {}) {
	        return new URLs(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.check_in = source["check_in"];
	        this.check_out = source["check_out"];
	    }
	}
	export class Settings {
	    schedule: Schedule;
	    urls: URLs;
	    autostart: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schedule = this.convertValues(source["schedule"], Schedule);
	        this.urls = this.convertValues(source["urls"], URLs);
	        this.autostart = source["autostart"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace scheduler {
	
	export class NextReminder {
	    type: string;
	    // Go type: time
	    at: any;
	
	    static createFrom(source: any = {}) {
	        return new NextReminder(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.at = this.convertValues(source["at"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

