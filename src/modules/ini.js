﻿exports.parse = exports.decode = decode;
exports.stringify = exports.encode = encode;

exports.safe = safe;
exports.unsafe = unsafe;
exports.getLagMessage = getLagMessage;

var eol = process.platform === "win32" ? "\r\n" : "\n";

function encode(obj, opt) {
    var children = [],
        out = "";
    
    if (typeof opt === "string") {
        opt = {
            section: opt,
            whitespace: false
        };
    } else {
        opt = opt || {};
        opt.whitespace = opt.whitespace === true;
    }
    
    var separator = " = ";
    
    Object.keys(obj).forEach(function (k, _, __) {
        var val = obj[k];
        if (val && Array.isArray(val)) {
            val.forEach(function (item) {
                out += safe(k + "[]") + separator + safe(item) + "\n";
            });
        } else if (val && typeof val === "object") {
            children.push(k);
        } else {
            out += safe(k) + separator + safe(val) + eol;
        }
    });
    
    if (opt.section && out.length) {
        out = "[" + safe(opt.section) + "]" + eol + out;
    }
    
    children.forEach(function (k, _, __) {
        var nk = dotSplit(k).join('\\.');
        var section = (opt.section ? opt.section + "." : "") + nk;
        var child = encode(obj[k], {
            section: section,
            whitespace: opt.whitespace
        });
        if (out.length && child.length) {
            out += eol;
        }
        out += child;
    });
    
    return out;
}

function dotSplit(str) {
    return str.replace(/\1/g, '\u0002LITERAL\\1LITERAL\u0002')
        .replace(/\\\./g, '\u0001')
        .split(/\./).map(function (part) {
        return part.replace(/\1/g, '\\.')
                .replace(/\2LITERAL\\1LITERAL\2/g, '\u0001');
    });
}

function decode(str) {
    var out = {},
        p = out,
        state = "START",
        // section     |key = value
        re = /^\[([^\]]*)\]$|^([^=]+)(=(.*))?$/i,
        lines = str.split(/[\r\n]+/g),
        section = null;
    
    lines.forEach(function (line, _, __) {
        var testLine = line.trim();
        
        // skip empty lines or commented lines
        if (!line || line.match(/^\s*[;#]/)) {
            // skip commented lines
            return;
        }
        // E.g. serverTimeout = 30
        // Returns ["serverTimeout = 30", undefined, "serverTimeout ", "= 30", "30"]
        var match = line.match(re);
        
        if (!match) {
            return;
        }
        
        if (match[1] !== undefined) {
            section = unsafe(match[1]);
            p = out[section] = out[section] || {};
            return;
        }
        
        var key = unsafe(match[2]),
            value = match[3] ? unsafe((match[4] || "")) : true;
        
        // Convert keys with '[]' suffix to an array
        if (key.length > 2 && key.slice(-2) === "[]") {
            key = key.substring(0, key.length - 2);
            if (!p[key]) {
                p[key] = [];
            } else if (!Array.isArray(p[key])) {
                p[key] = [p[key]];
            }
        }
        
        //// Mass to Size function catcher
        if (startsWith(value, "massToSize(") && endsWith(value, ")")) {
            // 11: length of "massToSize("
            var strValue = value.slice(11, value.length - 1).trim();
            value = Math.sqrt(parseFloat(strValue) * 100) + 0.5;
        }
        function startsWith(value, pattern) {
            return value.length >= pattern.length && 
                value.indexOf(pattern) === 0;
        };
        function endsWith(value, pattern) {
            return value.length >= pattern.length && 
                value.lastIndexOf(pattern) === value.length - pattern.length;
        };
        
        // safeguard against resetting a previously defined
        // array by accidentally forgetting the brackets
        if (isNaN(value)) {
            p[key] = value;
        } else if (isInt(value)) {
            p[key] = parseInt(value);
        } else {
            p[key] = parseFloat(value);
        }
    });
    
    // {a:{y:1},"a.b":{x:2}} --> {a:{y:1,b:{x:2}}}
    // use a filter to return the keys that have to be deleted.
    Object.keys(out).filter(function (k, _, __) {
        if (!out[k] || typeof out[k] !== "object" || Array.isArray(out[k])) return false;
        // see if the parent section is also an object.
        // if so, add it to that, and mark this one for deletion
        var parts = dotSplit(k),
            p = out,
            l = parts.pop(),
            nl = l.replace(/\\\./g, '.');
        parts.forEach(function (part, _, __) {
            if (!p[part] || typeof p[part] !== "object") {
                p[part] = {};
            }
            p = p[part];
        });
        if (p === out && nl === l) {
            return false;
        }
        p[nl] = out[k];
        return true;
    }).forEach(function (del, _, __) {
        delete out[del];
    });
    
    return out;
}

function isQuoted(val) {
    return (val.charAt(0) === "\"" && val.slice(-1) === "\"") || (val.charAt(0) === "'" && val.slice(-1) === "'");
}

function safe(val) {
    return (typeof val !== "string" || val.match(/[=\r\n]/) || val.match(/^\[/) || (val.length > 1 && isQuoted(val)) || val !== val.trim()) ? JSON.stringify(val) : val.replace(/;/g, '\\;').replace(/#/g, "\\#");
}

function unsafe(val, doUnesc) {
    val = (val || "").trim();
    if (isQuoted(val)) {
        // remove the single quotes before calling JSON.parse
        if (val.charAt(0) === "'") {
            val = val.substr(1, val.length - 2);
        }
        try {
            val = JSON.parse(val);
        } catch (err) {
            Logger.error(err.stack);
        }
    } else {
        // walk the val to find the first not-escaped ; character
        var esc = false;
        var unesc = "";
        for (var i = 0, l = val.length; i < l; i++) {
            var c = val.charAt(i);
            if (esc) {
                if ("\\;#".indexOf(c) !== -1)
                    unesc += c;
                else
                    unesc += "\\" + c;
                esc = false;
            } else if (";#".indexOf(c) !== -1) {
                break;
            } else if (c === "\\") {
                esc = true;
            } else {
                unesc += c;
            }
        }
        if (esc)
            unesc += "\\";
        return unesc;
    }
    return val;
}

var isInt = function (n) {
    return parseInt(n) == n;
};

function getLagMessage(updateTimeAvg) {
    if (updateTimeAvg < 20)
        return "perfectly smooth";
    if (updateTimeAvg < 35)
        return "good";
    if (updateTimeAvg < 40)
        return "tiny lag";
    if (updateTimeAvg < 50)
        return "lag";
    return "extremely high lag";
}
