const $path = require("path");
const $glob = require("glob");
const $chalk = require("chalk");
const $rimraf = require("rimraf");
const $stream = require("stream");
const $fs = require("fs");
const $os = require("os");
const $child = require("child_process");
const $tar = require("tar");


function get_cache_dir(name) {
    switch (process.platform) {
    case "win32":
        const local_app_data = process.env.LOCALAPPDATA || $path.join($os.homedir(), "AppData", "Local");
        return $path.join(local_app_data, name, "Cache");

    case "darwin":
        return $path.join($os.homedir(), "Library", "Caches", name);

    // https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
    default:
        const cache_dir = process.env.XDG_CACHE_HOME || $path.join($os.homedir(), ".cache");
        return $path.join(cache_dir, name);
    }
}

exports.get_cache_dir = get_cache_dir;


function posix_path(path) {
    return path.replace(/\\/g, $path.posix.sep);
}

exports.posix_path = posix_path;


function debug(s) {
    console.debug($chalk.blue("> " + s + "\n"));
}

exports.debug = debug;


function info(s) {
    console.info($chalk.yellow(s));
}

exports.info = info;


function glob(pattern, cwd) {
    return $glob.glob(pattern, {
        cwd: cwd,
        strict: true,
        absolute: true,
        nodir: true
    });
}

exports.glob = glob;


function rm(path) {
    return $rimraf.rimraf(path, { glob: false });
}

exports.rm = rm;


function mv(from, to) {
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

exports.mv = mv;


function mkdir(path) {
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

exports.mkdir = mkdir;


function exists(path) {
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

exports.exists = exists;


function read(path) {
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

exports.read = read;


function readString(path) {
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

exports.readString = readString;


function getEnv(name, fallback) {
    const value = process.env[name];

    if (value == null) {
        return fallback;

    } else {
        return value;
    }
}

exports.getEnv = getEnv;


function exec(cmd, options) {
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

exports.exec = exec;


function spawn(command, args, options) {
    return wait($child.spawn(command, args, options));
}

exports.spawn = spawn;


function wait(p) {
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

exports.wait = wait;


function tar(stream, options) {
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

exports.tar = tar;


const lockState = {
    locked: false,
    pending: [],
};

async function lock(f) {
    if (lockState.locked) {
        await new Promise(function (resolve, reject) {
            lockState.pending.push(resolve);
        });

        if (lockState.locked) {
            throw new Error("Invalid lock state");
        }
    }

    lockState.locked = true;

    try {
        return await f();

    } finally {
        lockState.locked = false;

        if (lockState.pending.length !== 0) {
            const resolve = lockState.pending.shift();
            // Wake up pending task
            resolve();
        }
    }
}

exports.lock = lock;
