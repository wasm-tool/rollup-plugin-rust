const $path = require("path");
const $glob = require("glob");
const $rimraf = require("rimraf");
const $fs = require("fs");
const $child = require("child_process");


function posix_path(path) {
    return path.replace(/\\/g, $path.posix.sep);
}

exports.posix_path = posix_path;


function glob(pattern, cwd) {
    return new Promise(function (resolve, reject) {
        $glob(pattern, {
            cwd: cwd,
            strict: true,
            absolute: true,
            nodir: true
        }, function (err, files) {
            if (err) {
                reject(err);

            } else {
                resolve(files);
            }
        });
    });
}

exports.glob = glob;


function rm(path) {
    return new Promise(function (resolve, reject) {
        $rimraf(path, { glob: false }, function (err) {
            if (err) {
                reject(err);

            } else {
                resolve();
            }
        });
    });
}

exports.rm = rm;


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
