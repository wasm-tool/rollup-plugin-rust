import * as $path from "node:path";
import * as $stream from "node:stream";
import * as $fs from "node:fs";
import * as $os from "node:os";
import * as $child from "node:child_process";

import * as $glob from "glob";
import * as $rimraf from "rimraf";
import * as $tar from "tar";
import $chalk from "chalk";


export function getCacheDir(name) {
    switch (process.platform) {
    case "win32":
        const localAppData = process.env.LOCALAPPDATA || $path.join($os.homedir(), "AppData", "Local");
        return $path.join(localAppData, name, "Cache");

    case "darwin":
        return $path.join($os.homedir(), "Library", "Caches", name);

    // https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
    default:
        const cacheDir = process.env.XDG_CACHE_HOME || $path.join($os.homedir(), ".cache");
        return $path.join(cacheDir, name);
    }
}


export function posixPath(path) {
    return path.replace(/\\/g, $path.posix.sep);
}


export function debug(s) {
    console.debug($chalk.blue("> " + s + "\n"));
}


export function info(s) {
    console.info($chalk.yellow(s));
}


export function glob(pattern, cwd) {
    return $glob.glob(pattern, {
        cwd: cwd,
        strict: true,
        absolute: true,
        nodir: true
    });
}


export function rm(path) {
    return $rimraf.rimraf(path, { glob: false });
}


export function mv(from, to) {
    return new Promise((resolve, reject) => {
        $fs.rename(from, to, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}


export function mkdir(path) {
    return new Promise((resolve, reject) => {
        $fs.mkdir(path, { recursive: true }, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}


export function exists(path) {
    return new Promise((resolve, reject) => {
        $fs.access(path, (err) => {
            if (err) {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}


export function read(path) {
    return new Promise(function (resolve, reject) {
        $fs.readFile(path, function (err, file) {
            if (err) {
                reject(err);

            } else {
                resolve(file);
            }
        });
    });
}


export function readString(path) {
    return new Promise(function (resolve, reject) {
        $fs.readFile(path, { encoding: "utf8" }, function (err, file) {
            if (err) {
                reject(err);

            } else {
                resolve(file);
            }
        });
    });
}


export function writeString(path, value) {
    return new Promise(function (resolve, reject) {
        $fs.writeFile(path, value, { encoding: "utf8" }, function (err) {
            if (err) {
                reject(err);

            } else {
                resolve();
            }
        });
    });
}


export function getEnv(name, fallback) {
    const value = process.env[name];

    if (value == null) {
        return fallback;

    } else {
        return value;
    }
}


export function exec(cmd, options) {
    return new Promise((resolve, reject) => {
        $child.exec(cmd, options, (err, stdout, stderr) => {
            if (err) {
                reject(err);

            } else if (stderr.length > 0) {
                reject(new Error(stderr));

            } else {
                resolve(stdout);
            }
        });
    });
}


export function spawn(command, args, options) {
    return wait($child.spawn(command, args, options));
}


export function wait(p) {
    return new Promise((resolve, reject) => {
        p.on("close", (code) => {
            if (code === 0) {
                resolve();

            } else {
                reject(new Error("Command `" + p.spawnargs.join(" ") + "` failed with error code: " + code));
            }
        });

        p.on("error", reject);
    });
}


export function tar(stream, options) {
    return new Promise((resolve, reject) => {
        $stream.pipeline(
            stream,
            $tar.x({
                cwd: options.cwd,
                strict: true,
            }, options.files),
            (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            },
        );
    });
}


export class Lock {
    constructor() {
        this.locked = false;
        this.pending = [];
    }

    async withLock(f) {
        await this.lock();

        try {
            return await f();

        } finally {
            this.unlock();
        }
    }

    async lock() {
        if (this.locked) {
            await new Promise((resolve, reject) => {
                this.pending.push(resolve);
            });

            if (this.locked) {
                throw new Error("Invalid lock state");
            }
        }

        this.locked = true;
    }

    unlock() {
        this.locked = false;

        if (this.pending.length !== 0) {
            const resolve = this.pending.shift();
            // Wake up pending task
            resolve();
        }
    }
}
