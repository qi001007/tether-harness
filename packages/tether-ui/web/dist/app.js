var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/react/cjs/react.production.min.js
var require_react_production_min = __commonJS({
  "node_modules/react/cjs/react.production.min.js"(exports) {
    "use strict";
    var l = Symbol.for("react.element");
    var n = Symbol.for("react.portal");
    var p = Symbol.for("react.fragment");
    var q = Symbol.for("react.strict_mode");
    var r = Symbol.for("react.profiler");
    var t = Symbol.for("react.provider");
    var u = Symbol.for("react.context");
    var v = Symbol.for("react.forward_ref");
    var w = Symbol.for("react.suspense");
    var x = Symbol.for("react.memo");
    var y = Symbol.for("react.lazy");
    var z = Symbol.iterator;
    function A(a) {
      if (null === a || "object" !== typeof a) return null;
      a = z && a[z] || a["@@iterator"];
      return "function" === typeof a ? a : null;
    }
    var B = { isMounted: function() {
      return false;
    }, enqueueForceUpdate: function() {
    }, enqueueReplaceState: function() {
    }, enqueueSetState: function() {
    } };
    var C2 = Object.assign;
    var D = {};
    function E(a, b, e) {
      this.props = a;
      this.context = b;
      this.refs = D;
      this.updater = e || B;
    }
    E.prototype.isReactComponent = {};
    E.prototype.setState = function(a, b) {
      if ("object" !== typeof a && "function" !== typeof a && null != a) throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");
      this.updater.enqueueSetState(this, a, b, "setState");
    };
    E.prototype.forceUpdate = function(a) {
      this.updater.enqueueForceUpdate(this, a, "forceUpdate");
    };
    function F() {
    }
    F.prototype = E.prototype;
    function G(a, b, e) {
      this.props = a;
      this.context = b;
      this.refs = D;
      this.updater = e || B;
    }
    var H = G.prototype = new F();
    H.constructor = G;
    C2(H, E.prototype);
    H.isPureReactComponent = true;
    var I = Array.isArray;
    var J = Object.prototype.hasOwnProperty;
    var K = { current: null };
    var L = { key: true, ref: true, __self: true, __source: true };
    function M(a, b, e) {
      var d, c = {}, k = null, h = null;
      if (null != b) for (d in void 0 !== b.ref && (h = b.ref), void 0 !== b.key && (k = "" + b.key), b) J.call(b, d) && !L.hasOwnProperty(d) && (c[d] = b[d]);
      var g = arguments.length - 2;
      if (1 === g) c.children = e;
      else if (1 < g) {
        for (var f = Array(g), m = 0; m < g; m++) f[m] = arguments[m + 2];
        c.children = f;
      }
      if (a && a.defaultProps) for (d in g = a.defaultProps, g) void 0 === c[d] && (c[d] = g[d]);
      return { $$typeof: l, type: a, key: k, ref: h, props: c, _owner: K.current };
    }
    function N(a, b) {
      return { $$typeof: l, type: a.type, key: b, ref: a.ref, props: a.props, _owner: a._owner };
    }
    function O(a) {
      return "object" === typeof a && null !== a && a.$$typeof === l;
    }
    function escape(a) {
      var b = { "=": "=0", ":": "=2" };
      return "$" + a.replace(/[=:]/g, function(a2) {
        return b[a2];
      });
    }
    var P = /\/+/g;
    function Q(a, b) {
      return "object" === typeof a && null !== a && null != a.key ? escape("" + a.key) : b.toString(36);
    }
    function R(a, b, e, d, c) {
      var k = typeof a;
      if ("undefined" === k || "boolean" === k) a = null;
      var h = false;
      if (null === a) h = true;
      else switch (k) {
        case "string":
        case "number":
          h = true;
          break;
        case "object":
          switch (a.$$typeof) {
            case l:
            case n:
              h = true;
          }
      }
      if (h) return h = a, c = c(h), a = "" === d ? "." + Q(h, 0) : d, I(c) ? (e = "", null != a && (e = a.replace(P, "$&/") + "/"), R(c, b, e, "", function(a2) {
        return a2;
      })) : null != c && (O(c) && (c = N(c, e + (!c.key || h && h.key === c.key ? "" : ("" + c.key).replace(P, "$&/") + "/") + a)), b.push(c)), 1;
      h = 0;
      d = "" === d ? "." : d + ":";
      if (I(a)) for (var g = 0; g < a.length; g++) {
        k = a[g];
        var f = d + Q(k, g);
        h += R(k, b, e, f, c);
      }
      else if (f = A(a), "function" === typeof f) for (a = f.call(a), g = 0; !(k = a.next()).done; ) k = k.value, f = d + Q(k, g++), h += R(k, b, e, f, c);
      else if ("object" === k) throw b = String(a), Error("Objects are not valid as a React child (found: " + ("[object Object]" === b ? "object with keys {" + Object.keys(a).join(", ") + "}" : b) + "). If you meant to render a collection of children, use an array instead.");
      return h;
    }
    function S(a, b, e) {
      if (null == a) return a;
      var d = [], c = 0;
      R(a, d, "", "", function(a2) {
        return b.call(e, a2, c++);
      });
      return d;
    }
    function T(a) {
      if (-1 === a._status) {
        var b = a._result;
        b = b();
        b.then(function(b2) {
          if (0 === a._status || -1 === a._status) a._status = 1, a._result = b2;
        }, function(b2) {
          if (0 === a._status || -1 === a._status) a._status = 2, a._result = b2;
        });
        -1 === a._status && (a._status = 0, a._result = b);
      }
      if (1 === a._status) return a._result.default;
      throw a._result;
    }
    var U = { current: null };
    var V = { transition: null };
    var W = { ReactCurrentDispatcher: U, ReactCurrentBatchConfig: V, ReactCurrentOwner: K };
    function X() {
      throw Error("act(...) is not supported in production builds of React.");
    }
    exports.Children = { map: S, forEach: function(a, b, e) {
      S(a, function() {
        b.apply(this, arguments);
      }, e);
    }, count: function(a) {
      var b = 0;
      S(a, function() {
        b++;
      });
      return b;
    }, toArray: function(a) {
      return S(a, function(a2) {
        return a2;
      }) || [];
    }, only: function(a) {
      if (!O(a)) throw Error("React.Children.only expected to receive a single React element child.");
      return a;
    } };
    exports.Component = E;
    exports.Fragment = p;
    exports.Profiler = r;
    exports.PureComponent = G;
    exports.StrictMode = q;
    exports.Suspense = w;
    exports.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = W;
    exports.act = X;
    exports.cloneElement = function(a, b, e) {
      if (null === a || void 0 === a) throw Error("React.cloneElement(...): The argument must be a React element, but you passed " + a + ".");
      var d = C2({}, a.props), c = a.key, k = a.ref, h = a._owner;
      if (null != b) {
        void 0 !== b.ref && (k = b.ref, h = K.current);
        void 0 !== b.key && (c = "" + b.key);
        if (a.type && a.type.defaultProps) var g = a.type.defaultProps;
        for (f in b) J.call(b, f) && !L.hasOwnProperty(f) && (d[f] = void 0 === b[f] && void 0 !== g ? g[f] : b[f]);
      }
      var f = arguments.length - 2;
      if (1 === f) d.children = e;
      else if (1 < f) {
        g = Array(f);
        for (var m = 0; m < f; m++) g[m] = arguments[m + 2];
        d.children = g;
      }
      return { $$typeof: l, type: a.type, key: c, ref: k, props: d, _owner: h };
    };
    exports.createContext = function(a) {
      a = { $$typeof: u, _currentValue: a, _currentValue2: a, _threadCount: 0, Provider: null, Consumer: null, _defaultValue: null, _globalName: null };
      a.Provider = { $$typeof: t, _context: a };
      return a.Consumer = a;
    };
    exports.createElement = M;
    exports.createFactory = function(a) {
      var b = M.bind(null, a);
      b.type = a;
      return b;
    };
    exports.createRef = function() {
      return { current: null };
    };
    exports.forwardRef = function(a) {
      return { $$typeof: v, render: a };
    };
    exports.isValidElement = O;
    exports.lazy = function(a) {
      return { $$typeof: y, _payload: { _status: -1, _result: a }, _init: T };
    };
    exports.memo = function(a, b) {
      return { $$typeof: x, type: a, compare: void 0 === b ? null : b };
    };
    exports.startTransition = function(a) {
      var b = V.transition;
      V.transition = {};
      try {
        a();
      } finally {
        V.transition = b;
      }
    };
    exports.unstable_act = X;
    exports.useCallback = function(a, b) {
      return U.current.useCallback(a, b);
    };
    exports.useContext = function(a) {
      return U.current.useContext(a);
    };
    exports.useDebugValue = function() {
    };
    exports.useDeferredValue = function(a) {
      return U.current.useDeferredValue(a);
    };
    exports.useEffect = function(a, b) {
      return U.current.useEffect(a, b);
    };
    exports.useId = function() {
      return U.current.useId();
    };
    exports.useImperativeHandle = function(a, b, e) {
      return U.current.useImperativeHandle(a, b, e);
    };
    exports.useInsertionEffect = function(a, b) {
      return U.current.useInsertionEffect(a, b);
    };
    exports.useLayoutEffect = function(a, b) {
      return U.current.useLayoutEffect(a, b);
    };
    exports.useMemo = function(a, b) {
      return U.current.useMemo(a, b);
    };
    exports.useReducer = function(a, b, e) {
      return U.current.useReducer(a, b, e);
    };
    exports.useRef = function(a) {
      return U.current.useRef(a);
    };
    exports.useState = function(a) {
      return U.current.useState(a);
    };
    exports.useSyncExternalStore = function(a, b, e) {
      return U.current.useSyncExternalStore(a, b, e);
    };
    exports.useTransition = function() {
      return U.current.useTransition();
    };
    exports.version = "18.3.1";
  }
});

// node_modules/react/index.js
var require_react = __commonJS({
  "node_modules/react/index.js"(exports, module) {
    "use strict";
    if (true) {
      module.exports = require_react_production_min();
    } else {
      module.exports = null;
    }
  }
});

// node_modules/scheduler/cjs/scheduler.production.min.js
var require_scheduler_production_min = __commonJS({
  "node_modules/scheduler/cjs/scheduler.production.min.js"(exports) {
    "use strict";
    function f(a, b) {
      var c = a.length;
      a.push(b);
      a: for (; 0 < c; ) {
        var d = c - 1 >>> 1, e = a[d];
        if (0 < g(e, b)) a[d] = b, a[c] = e, c = d;
        else break a;
      }
    }
    function h(a) {
      return 0 === a.length ? null : a[0];
    }
    function k(a) {
      if (0 === a.length) return null;
      var b = a[0], c = a.pop();
      if (c !== b) {
        a[0] = c;
        a: for (var d = 0, e = a.length, w = e >>> 1; d < w; ) {
          var m = 2 * (d + 1) - 1, C2 = a[m], n = m + 1, x = a[n];
          if (0 > g(C2, c)) n < e && 0 > g(x, C2) ? (a[d] = x, a[n] = c, d = n) : (a[d] = C2, a[m] = c, d = m);
          else if (n < e && 0 > g(x, c)) a[d] = x, a[n] = c, d = n;
          else break a;
        }
      }
      return b;
    }
    function g(a, b) {
      var c = a.sortIndex - b.sortIndex;
      return 0 !== c ? c : a.id - b.id;
    }
    if ("object" === typeof performance && "function" === typeof performance.now) {
      l = performance;
      exports.unstable_now = function() {
        return l.now();
      };
    } else {
      p = Date, q = p.now();
      exports.unstable_now = function() {
        return p.now() - q;
      };
    }
    var l;
    var p;
    var q;
    var r = [];
    var t = [];
    var u = 1;
    var v = null;
    var y = 3;
    var z = false;
    var A = false;
    var B = false;
    var D = "function" === typeof setTimeout ? setTimeout : null;
    var E = "function" === typeof clearTimeout ? clearTimeout : null;
    var F = "undefined" !== typeof setImmediate ? setImmediate : null;
    "undefined" !== typeof navigator && void 0 !== navigator.scheduling && void 0 !== navigator.scheduling.isInputPending && navigator.scheduling.isInputPending.bind(navigator.scheduling);
    function G(a) {
      for (var b = h(t); null !== b; ) {
        if (null === b.callback) k(t);
        else if (b.startTime <= a) k(t), b.sortIndex = b.expirationTime, f(r, b);
        else break;
        b = h(t);
      }
    }
    function H(a) {
      B = false;
      G(a);
      if (!A) if (null !== h(r)) A = true, I(J);
      else {
        var b = h(t);
        null !== b && K(H, b.startTime - a);
      }
    }
    function J(a, b) {
      A = false;
      B && (B = false, E(L), L = -1);
      z = true;
      var c = y;
      try {
        G(b);
        for (v = h(r); null !== v && (!(v.expirationTime > b) || a && !M()); ) {
          var d = v.callback;
          if ("function" === typeof d) {
            v.callback = null;
            y = v.priorityLevel;
            var e = d(v.expirationTime <= b);
            b = exports.unstable_now();
            "function" === typeof e ? v.callback = e : v === h(r) && k(r);
            G(b);
          } else k(r);
          v = h(r);
        }
        if (null !== v) var w = true;
        else {
          var m = h(t);
          null !== m && K(H, m.startTime - b);
          w = false;
        }
        return w;
      } finally {
        v = null, y = c, z = false;
      }
    }
    var N = false;
    var O = null;
    var L = -1;
    var P = 5;
    var Q = -1;
    function M() {
      return exports.unstable_now() - Q < P ? false : true;
    }
    function R() {
      if (null !== O) {
        var a = exports.unstable_now();
        Q = a;
        var b = true;
        try {
          b = O(true, a);
        } finally {
          b ? S() : (N = false, O = null);
        }
      } else N = false;
    }
    var S;
    if ("function" === typeof F) S = function() {
      F(R);
    };
    else if ("undefined" !== typeof MessageChannel) {
      T = new MessageChannel(), U = T.port2;
      T.port1.onmessage = R;
      S = function() {
        U.postMessage(null);
      };
    } else S = function() {
      D(R, 0);
    };
    var T;
    var U;
    function I(a) {
      O = a;
      N || (N = true, S());
    }
    function K(a, b) {
      L = D(function() {
        a(exports.unstable_now());
      }, b);
    }
    exports.unstable_IdlePriority = 5;
    exports.unstable_ImmediatePriority = 1;
    exports.unstable_LowPriority = 4;
    exports.unstable_NormalPriority = 3;
    exports.unstable_Profiling = null;
    exports.unstable_UserBlockingPriority = 2;
    exports.unstable_cancelCallback = function(a) {
      a.callback = null;
    };
    exports.unstable_continueExecution = function() {
      A || z || (A = true, I(J));
    };
    exports.unstable_forceFrameRate = function(a) {
      0 > a || 125 < a ? console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported") : P = 0 < a ? Math.floor(1e3 / a) : 5;
    };
    exports.unstable_getCurrentPriorityLevel = function() {
      return y;
    };
    exports.unstable_getFirstCallbackNode = function() {
      return h(r);
    };
    exports.unstable_next = function(a) {
      switch (y) {
        case 1:
        case 2:
        case 3:
          var b = 3;
          break;
        default:
          b = y;
      }
      var c = y;
      y = b;
      try {
        return a();
      } finally {
        y = c;
      }
    };
    exports.unstable_pauseExecution = function() {
    };
    exports.unstable_requestPaint = function() {
    };
    exports.unstable_runWithPriority = function(a, b) {
      switch (a) {
        case 1:
        case 2:
        case 3:
        case 4:
        case 5:
          break;
        default:
          a = 3;
      }
      var c = y;
      y = a;
      try {
        return b();
      } finally {
        y = c;
      }
    };
    exports.unstable_scheduleCallback = function(a, b, c) {
      var d = exports.unstable_now();
      "object" === typeof c && null !== c ? (c = c.delay, c = "number" === typeof c && 0 < c ? d + c : d) : c = d;
      switch (a) {
        case 1:
          var e = -1;
          break;
        case 2:
          e = 250;
          break;
        case 5:
          e = 1073741823;
          break;
        case 4:
          e = 1e4;
          break;
        default:
          e = 5e3;
      }
      e = c + e;
      a = { id: u++, callback: b, priorityLevel: a, startTime: c, expirationTime: e, sortIndex: -1 };
      c > d ? (a.sortIndex = c, f(t, a), null === h(r) && a === h(t) && (B ? (E(L), L = -1) : B = true, K(H, c - d))) : (a.sortIndex = e, f(r, a), A || z || (A = true, I(J)));
      return a;
    };
    exports.unstable_shouldYield = M;
    exports.unstable_wrapCallback = function(a) {
      var b = y;
      return function() {
        var c = y;
        y = b;
        try {
          return a.apply(this, arguments);
        } finally {
          y = c;
        }
      };
    };
  }
});

// node_modules/scheduler/index.js
var require_scheduler = __commonJS({
  "node_modules/scheduler/index.js"(exports, module) {
    "use strict";
    if (true) {
      module.exports = require_scheduler_production_min();
    } else {
      module.exports = null;
    }
  }
});

// node_modules/react-dom/cjs/react-dom.production.min.js
var require_react_dom_production_min = __commonJS({
  "node_modules/react-dom/cjs/react-dom.production.min.js"(exports) {
    "use strict";
    var aa = require_react();
    var ca = require_scheduler();
    function p(a) {
      for (var b = "https://reactjs.org/docs/error-decoder.html?invariant=" + a, c = 1; c < arguments.length; c++) b += "&args[]=" + encodeURIComponent(arguments[c]);
      return "Minified React error #" + a + "; visit " + b + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
    }
    var da = /* @__PURE__ */ new Set();
    var ea = {};
    function fa(a, b) {
      ha(a, b);
      ha(a + "Capture", b);
    }
    function ha(a, b) {
      ea[a] = b;
      for (a = 0; a < b.length; a++) da.add(b[a]);
    }
    var ia = !("undefined" === typeof window || "undefined" === typeof window.document || "undefined" === typeof window.document.createElement);
    var ja = Object.prototype.hasOwnProperty;
    var ka = /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/;
    var la = {};
    var ma = {};
    function oa(a) {
      if (ja.call(ma, a)) return true;
      if (ja.call(la, a)) return false;
      if (ka.test(a)) return ma[a] = true;
      la[a] = true;
      return false;
    }
    function pa(a, b, c, d) {
      if (null !== c && 0 === c.type) return false;
      switch (typeof b) {
        case "function":
        case "symbol":
          return true;
        case "boolean":
          if (d) return false;
          if (null !== c) return !c.acceptsBooleans;
          a = a.toLowerCase().slice(0, 5);
          return "data-" !== a && "aria-" !== a;
        default:
          return false;
      }
    }
    function qa(a, b, c, d) {
      if (null === b || "undefined" === typeof b || pa(a, b, c, d)) return true;
      if (d) return false;
      if (null !== c) switch (c.type) {
        case 3:
          return !b;
        case 4:
          return false === b;
        case 5:
          return isNaN(b);
        case 6:
          return isNaN(b) || 1 > b;
      }
      return false;
    }
    function v(a, b, c, d, e, f, g) {
      this.acceptsBooleans = 2 === b || 3 === b || 4 === b;
      this.attributeName = d;
      this.attributeNamespace = e;
      this.mustUseProperty = c;
      this.propertyName = a;
      this.type = b;
      this.sanitizeURL = f;
      this.removeEmptyString = g;
    }
    var z = {};
    "children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(function(a) {
      z[a] = new v(a, 0, false, a, null, false, false);
    });
    [["acceptCharset", "accept-charset"], ["className", "class"], ["htmlFor", "for"], ["httpEquiv", "http-equiv"]].forEach(function(a) {
      var b = a[0];
      z[b] = new v(b, 1, false, a[1], null, false, false);
    });
    ["contentEditable", "draggable", "spellCheck", "value"].forEach(function(a) {
      z[a] = new v(a, 2, false, a.toLowerCase(), null, false, false);
    });
    ["autoReverse", "externalResourcesRequired", "focusable", "preserveAlpha"].forEach(function(a) {
      z[a] = new v(a, 2, false, a, null, false, false);
    });
    "allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(function(a) {
      z[a] = new v(a, 3, false, a.toLowerCase(), null, false, false);
    });
    ["checked", "multiple", "muted", "selected"].forEach(function(a) {
      z[a] = new v(a, 3, true, a, null, false, false);
    });
    ["capture", "download"].forEach(function(a) {
      z[a] = new v(a, 4, false, a, null, false, false);
    });
    ["cols", "rows", "size", "span"].forEach(function(a) {
      z[a] = new v(a, 6, false, a, null, false, false);
    });
    ["rowSpan", "start"].forEach(function(a) {
      z[a] = new v(a, 5, false, a.toLowerCase(), null, false, false);
    });
    var ra = /[\-:]([a-z])/g;
    function sa(a) {
      return a[1].toUpperCase();
    }
    "accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(function(a) {
      var b = a.replace(
        ra,
        sa
      );
      z[b] = new v(b, 1, false, a, null, false, false);
    });
    "xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function(a) {
      var b = a.replace(ra, sa);
      z[b] = new v(b, 1, false, a, "http://www.w3.org/1999/xlink", false, false);
    });
    ["xml:base", "xml:lang", "xml:space"].forEach(function(a) {
      var b = a.replace(ra, sa);
      z[b] = new v(b, 1, false, a, "http://www.w3.org/XML/1998/namespace", false, false);
    });
    ["tabIndex", "crossOrigin"].forEach(function(a) {
      z[a] = new v(a, 1, false, a.toLowerCase(), null, false, false);
    });
    z.xlinkHref = new v("xlinkHref", 1, false, "xlink:href", "http://www.w3.org/1999/xlink", true, false);
    ["src", "href", "action", "formAction"].forEach(function(a) {
      z[a] = new v(a, 1, false, a.toLowerCase(), null, true, true);
    });
    function ta(a, b, c, d) {
      var e = z.hasOwnProperty(b) ? z[b] : null;
      if (null !== e ? 0 !== e.type : d || !(2 < b.length) || "o" !== b[0] && "O" !== b[0] || "n" !== b[1] && "N" !== b[1]) qa(b, c, e, d) && (c = null), d || null === e ? oa(b) && (null === c ? a.removeAttribute(b) : a.setAttribute(b, "" + c)) : e.mustUseProperty ? a[e.propertyName] = null === c ? 3 === e.type ? false : "" : c : (b = e.attributeName, d = e.attributeNamespace, null === c ? a.removeAttribute(b) : (e = e.type, c = 3 === e || 4 === e && true === c ? "" : "" + c, d ? a.setAttributeNS(d, b, c) : a.setAttribute(b, c)));
    }
    var ua = aa.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    var va = Symbol.for("react.element");
    var wa = Symbol.for("react.portal");
    var ya = Symbol.for("react.fragment");
    var za = Symbol.for("react.strict_mode");
    var Aa = Symbol.for("react.profiler");
    var Ba = Symbol.for("react.provider");
    var Ca = Symbol.for("react.context");
    var Da = Symbol.for("react.forward_ref");
    var Ea = Symbol.for("react.suspense");
    var Fa = Symbol.for("react.suspense_list");
    var Ga = Symbol.for("react.memo");
    var Ha = Symbol.for("react.lazy");
    Symbol.for("react.scope");
    Symbol.for("react.debug_trace_mode");
    var Ia = Symbol.for("react.offscreen");
    Symbol.for("react.legacy_hidden");
    Symbol.for("react.cache");
    Symbol.for("react.tracing_marker");
    var Ja = Symbol.iterator;
    function Ka(a) {
      if (null === a || "object" !== typeof a) return null;
      a = Ja && a[Ja] || a["@@iterator"];
      return "function" === typeof a ? a : null;
    }
    var A = Object.assign;
    var La;
    function Ma(a) {
      if (void 0 === La) try {
        throw Error();
      } catch (c) {
        var b = c.stack.trim().match(/\n( *(at )?)/);
        La = b && b[1] || "";
      }
      return "\n" + La + a;
    }
    var Na = false;
    function Oa(a, b) {
      if (!a || Na) return "";
      Na = true;
      var c = Error.prepareStackTrace;
      Error.prepareStackTrace = void 0;
      try {
        if (b) if (b = function() {
          throw Error();
        }, Object.defineProperty(b.prototype, "props", { set: function() {
          throw Error();
        } }), "object" === typeof Reflect && Reflect.construct) {
          try {
            Reflect.construct(b, []);
          } catch (l) {
            var d = l;
          }
          Reflect.construct(a, [], b);
        } else {
          try {
            b.call();
          } catch (l) {
            d = l;
          }
          a.call(b.prototype);
        }
        else {
          try {
            throw Error();
          } catch (l) {
            d = l;
          }
          a();
        }
      } catch (l) {
        if (l && d && "string" === typeof l.stack) {
          for (var e = l.stack.split("\n"), f = d.stack.split("\n"), g = e.length - 1, h = f.length - 1; 1 <= g && 0 <= h && e[g] !== f[h]; ) h--;
          for (; 1 <= g && 0 <= h; g--, h--) if (e[g] !== f[h]) {
            if (1 !== g || 1 !== h) {
              do
                if (g--, h--, 0 > h || e[g] !== f[h]) {
                  var k = "\n" + e[g].replace(" at new ", " at ");
                  a.displayName && k.includes("<anonymous>") && (k = k.replace("<anonymous>", a.displayName));
                  return k;
                }
              while (1 <= g && 0 <= h);
            }
            break;
          }
        }
      } finally {
        Na = false, Error.prepareStackTrace = c;
      }
      return (a = a ? a.displayName || a.name : "") ? Ma(a) : "";
    }
    function Pa(a) {
      switch (a.tag) {
        case 5:
          return Ma(a.type);
        case 16:
          return Ma("Lazy");
        case 13:
          return Ma("Suspense");
        case 19:
          return Ma("SuspenseList");
        case 0:
        case 2:
        case 15:
          return a = Oa(a.type, false), a;
        case 11:
          return a = Oa(a.type.render, false), a;
        case 1:
          return a = Oa(a.type, true), a;
        default:
          return "";
      }
    }
    function Qa(a) {
      if (null == a) return null;
      if ("function" === typeof a) return a.displayName || a.name || null;
      if ("string" === typeof a) return a;
      switch (a) {
        case ya:
          return "Fragment";
        case wa:
          return "Portal";
        case Aa:
          return "Profiler";
        case za:
          return "StrictMode";
        case Ea:
          return "Suspense";
        case Fa:
          return "SuspenseList";
      }
      if ("object" === typeof a) switch (a.$$typeof) {
        case Ca:
          return (a.displayName || "Context") + ".Consumer";
        case Ba:
          return (a._context.displayName || "Context") + ".Provider";
        case Da:
          var b = a.render;
          a = a.displayName;
          a || (a = b.displayName || b.name || "", a = "" !== a ? "ForwardRef(" + a + ")" : "ForwardRef");
          return a;
        case Ga:
          return b = a.displayName || null, null !== b ? b : Qa(a.type) || "Memo";
        case Ha:
          b = a._payload;
          a = a._init;
          try {
            return Qa(a(b));
          } catch (c) {
          }
      }
      return null;
    }
    function Ra(a) {
      var b = a.type;
      switch (a.tag) {
        case 24:
          return "Cache";
        case 9:
          return (b.displayName || "Context") + ".Consumer";
        case 10:
          return (b._context.displayName || "Context") + ".Provider";
        case 18:
          return "DehydratedFragment";
        case 11:
          return a = b.render, a = a.displayName || a.name || "", b.displayName || ("" !== a ? "ForwardRef(" + a + ")" : "ForwardRef");
        case 7:
          return "Fragment";
        case 5:
          return b;
        case 4:
          return "Portal";
        case 3:
          return "Root";
        case 6:
          return "Text";
        case 16:
          return Qa(b);
        case 8:
          return b === za ? "StrictMode" : "Mode";
        case 22:
          return "Offscreen";
        case 12:
          return "Profiler";
        case 21:
          return "Scope";
        case 13:
          return "Suspense";
        case 19:
          return "SuspenseList";
        case 25:
          return "TracingMarker";
        case 1:
        case 0:
        case 17:
        case 2:
        case 14:
        case 15:
          if ("function" === typeof b) return b.displayName || b.name || null;
          if ("string" === typeof b) return b;
      }
      return null;
    }
    function Sa(a) {
      switch (typeof a) {
        case "boolean":
        case "number":
        case "string":
        case "undefined":
          return a;
        case "object":
          return a;
        default:
          return "";
      }
    }
    function Ta(a) {
      var b = a.type;
      return (a = a.nodeName) && "input" === a.toLowerCase() && ("checkbox" === b || "radio" === b);
    }
    function Ua(a) {
      var b = Ta(a) ? "checked" : "value", c = Object.getOwnPropertyDescriptor(a.constructor.prototype, b), d = "" + a[b];
      if (!a.hasOwnProperty(b) && "undefined" !== typeof c && "function" === typeof c.get && "function" === typeof c.set) {
        var e = c.get, f = c.set;
        Object.defineProperty(a, b, { configurable: true, get: function() {
          return e.call(this);
        }, set: function(a2) {
          d = "" + a2;
          f.call(this, a2);
        } });
        Object.defineProperty(a, b, { enumerable: c.enumerable });
        return { getValue: function() {
          return d;
        }, setValue: function(a2) {
          d = "" + a2;
        }, stopTracking: function() {
          a._valueTracker = null;
          delete a[b];
        } };
      }
    }
    function Va(a) {
      a._valueTracker || (a._valueTracker = Ua(a));
    }
    function Wa(a) {
      if (!a) return false;
      var b = a._valueTracker;
      if (!b) return true;
      var c = b.getValue();
      var d = "";
      a && (d = Ta(a) ? a.checked ? "true" : "false" : a.value);
      a = d;
      return a !== c ? (b.setValue(a), true) : false;
    }
    function Xa(a) {
      a = a || ("undefined" !== typeof document ? document : void 0);
      if ("undefined" === typeof a) return null;
      try {
        return a.activeElement || a.body;
      } catch (b) {
        return a.body;
      }
    }
    function Ya(a, b) {
      var c = b.checked;
      return A({}, b, { defaultChecked: void 0, defaultValue: void 0, value: void 0, checked: null != c ? c : a._wrapperState.initialChecked });
    }
    function Za(a, b) {
      var c = null == b.defaultValue ? "" : b.defaultValue, d = null != b.checked ? b.checked : b.defaultChecked;
      c = Sa(null != b.value ? b.value : c);
      a._wrapperState = { initialChecked: d, initialValue: c, controlled: "checkbox" === b.type || "radio" === b.type ? null != b.checked : null != b.value };
    }
    function ab(a, b) {
      b = b.checked;
      null != b && ta(a, "checked", b, false);
    }
    function bb(a, b) {
      ab(a, b);
      var c = Sa(b.value), d = b.type;
      if (null != c) if ("number" === d) {
        if (0 === c && "" === a.value || a.value != c) a.value = "" + c;
      } else a.value !== "" + c && (a.value = "" + c);
      else if ("submit" === d || "reset" === d) {
        a.removeAttribute("value");
        return;
      }
      b.hasOwnProperty("value") ? cb(a, b.type, c) : b.hasOwnProperty("defaultValue") && cb(a, b.type, Sa(b.defaultValue));
      null == b.checked && null != b.defaultChecked && (a.defaultChecked = !!b.defaultChecked);
    }
    function db(a, b, c) {
      if (b.hasOwnProperty("value") || b.hasOwnProperty("defaultValue")) {
        var d = b.type;
        if (!("submit" !== d && "reset" !== d || void 0 !== b.value && null !== b.value)) return;
        b = "" + a._wrapperState.initialValue;
        c || b === a.value || (a.value = b);
        a.defaultValue = b;
      }
      c = a.name;
      "" !== c && (a.name = "");
      a.defaultChecked = !!a._wrapperState.initialChecked;
      "" !== c && (a.name = c);
    }
    function cb(a, b, c) {
      if ("number" !== b || Xa(a.ownerDocument) !== a) null == c ? a.defaultValue = "" + a._wrapperState.initialValue : a.defaultValue !== "" + c && (a.defaultValue = "" + c);
    }
    var eb = Array.isArray;
    function fb(a, b, c, d) {
      a = a.options;
      if (b) {
        b = {};
        for (var e = 0; e < c.length; e++) b["$" + c[e]] = true;
        for (c = 0; c < a.length; c++) e = b.hasOwnProperty("$" + a[c].value), a[c].selected !== e && (a[c].selected = e), e && d && (a[c].defaultSelected = true);
      } else {
        c = "" + Sa(c);
        b = null;
        for (e = 0; e < a.length; e++) {
          if (a[e].value === c) {
            a[e].selected = true;
            d && (a[e].defaultSelected = true);
            return;
          }
          null !== b || a[e].disabled || (b = a[e]);
        }
        null !== b && (b.selected = true);
      }
    }
    function gb(a, b) {
      if (null != b.dangerouslySetInnerHTML) throw Error(p(91));
      return A({}, b, { value: void 0, defaultValue: void 0, children: "" + a._wrapperState.initialValue });
    }
    function hb(a, b) {
      var c = b.value;
      if (null == c) {
        c = b.children;
        b = b.defaultValue;
        if (null != c) {
          if (null != b) throw Error(p(92));
          if (eb(c)) {
            if (1 < c.length) throw Error(p(93));
            c = c[0];
          }
          b = c;
        }
        null == b && (b = "");
        c = b;
      }
      a._wrapperState = { initialValue: Sa(c) };
    }
    function ib(a, b) {
      var c = Sa(b.value), d = Sa(b.defaultValue);
      null != c && (c = "" + c, c !== a.value && (a.value = c), null == b.defaultValue && a.defaultValue !== c && (a.defaultValue = c));
      null != d && (a.defaultValue = "" + d);
    }
    function jb(a) {
      var b = a.textContent;
      b === a._wrapperState.initialValue && "" !== b && null !== b && (a.value = b);
    }
    function kb(a) {
      switch (a) {
        case "svg":
          return "http://www.w3.org/2000/svg";
        case "math":
          return "http://www.w3.org/1998/Math/MathML";
        default:
          return "http://www.w3.org/1999/xhtml";
      }
    }
    function lb(a, b) {
      return null == a || "http://www.w3.org/1999/xhtml" === a ? kb(b) : "http://www.w3.org/2000/svg" === a && "foreignObject" === b ? "http://www.w3.org/1999/xhtml" : a;
    }
    var mb;
    var nb = (function(a) {
      return "undefined" !== typeof MSApp && MSApp.execUnsafeLocalFunction ? function(b, c, d, e) {
        MSApp.execUnsafeLocalFunction(function() {
          return a(b, c, d, e);
        });
      } : a;
    })(function(a, b) {
      if ("http://www.w3.org/2000/svg" !== a.namespaceURI || "innerHTML" in a) a.innerHTML = b;
      else {
        mb = mb || document.createElement("div");
        mb.innerHTML = "<svg>" + b.valueOf().toString() + "</svg>";
        for (b = mb.firstChild; a.firstChild; ) a.removeChild(a.firstChild);
        for (; b.firstChild; ) a.appendChild(b.firstChild);
      }
    });
    function ob(a, b) {
      if (b) {
        var c = a.firstChild;
        if (c && c === a.lastChild && 3 === c.nodeType) {
          c.nodeValue = b;
          return;
        }
      }
      a.textContent = b;
    }
    var pb = {
      animationIterationCount: true,
      aspectRatio: true,
      borderImageOutset: true,
      borderImageSlice: true,
      borderImageWidth: true,
      boxFlex: true,
      boxFlexGroup: true,
      boxOrdinalGroup: true,
      columnCount: true,
      columns: true,
      flex: true,
      flexGrow: true,
      flexPositive: true,
      flexShrink: true,
      flexNegative: true,
      flexOrder: true,
      gridArea: true,
      gridRow: true,
      gridRowEnd: true,
      gridRowSpan: true,
      gridRowStart: true,
      gridColumn: true,
      gridColumnEnd: true,
      gridColumnSpan: true,
      gridColumnStart: true,
      fontWeight: true,
      lineClamp: true,
      lineHeight: true,
      opacity: true,
      order: true,
      orphans: true,
      tabSize: true,
      widows: true,
      zIndex: true,
      zoom: true,
      fillOpacity: true,
      floodOpacity: true,
      stopOpacity: true,
      strokeDasharray: true,
      strokeDashoffset: true,
      strokeMiterlimit: true,
      strokeOpacity: true,
      strokeWidth: true
    };
    var qb = ["Webkit", "ms", "Moz", "O"];
    Object.keys(pb).forEach(function(a) {
      qb.forEach(function(b) {
        b = b + a.charAt(0).toUpperCase() + a.substring(1);
        pb[b] = pb[a];
      });
    });
    function rb(a, b, c) {
      return null == b || "boolean" === typeof b || "" === b ? "" : c || "number" !== typeof b || 0 === b || pb.hasOwnProperty(a) && pb[a] ? ("" + b).trim() : b + "px";
    }
    function sb(a, b) {
      a = a.style;
      for (var c in b) if (b.hasOwnProperty(c)) {
        var d = 0 === c.indexOf("--"), e = rb(c, b[c], d);
        "float" === c && (c = "cssFloat");
        d ? a.setProperty(c, e) : a[c] = e;
      }
    }
    var tb = A({ menuitem: true }, { area: true, base: true, br: true, col: true, embed: true, hr: true, img: true, input: true, keygen: true, link: true, meta: true, param: true, source: true, track: true, wbr: true });
    function ub(a, b) {
      if (b) {
        if (tb[a] && (null != b.children || null != b.dangerouslySetInnerHTML)) throw Error(p(137, a));
        if (null != b.dangerouslySetInnerHTML) {
          if (null != b.children) throw Error(p(60));
          if ("object" !== typeof b.dangerouslySetInnerHTML || !("__html" in b.dangerouslySetInnerHTML)) throw Error(p(61));
        }
        if (null != b.style && "object" !== typeof b.style) throw Error(p(62));
      }
    }
    function vb(a, b) {
      if (-1 === a.indexOf("-")) return "string" === typeof b.is;
      switch (a) {
        case "annotation-xml":
        case "color-profile":
        case "font-face":
        case "font-face-src":
        case "font-face-uri":
        case "font-face-format":
        case "font-face-name":
        case "missing-glyph":
          return false;
        default:
          return true;
      }
    }
    var wb = null;
    function xb(a) {
      a = a.target || a.srcElement || window;
      a.correspondingUseElement && (a = a.correspondingUseElement);
      return 3 === a.nodeType ? a.parentNode : a;
    }
    var yb = null;
    var zb = null;
    var Ab = null;
    function Bb(a) {
      if (a = Cb(a)) {
        if ("function" !== typeof yb) throw Error(p(280));
        var b = a.stateNode;
        b && (b = Db(b), yb(a.stateNode, a.type, b));
      }
    }
    function Eb(a) {
      zb ? Ab ? Ab.push(a) : Ab = [a] : zb = a;
    }
    function Fb() {
      if (zb) {
        var a = zb, b = Ab;
        Ab = zb = null;
        Bb(a);
        if (b) for (a = 0; a < b.length; a++) Bb(b[a]);
      }
    }
    function Gb(a, b) {
      return a(b);
    }
    function Hb() {
    }
    var Ib = false;
    function Jb(a, b, c) {
      if (Ib) return a(b, c);
      Ib = true;
      try {
        return Gb(a, b, c);
      } finally {
        if (Ib = false, null !== zb || null !== Ab) Hb(), Fb();
      }
    }
    function Kb(a, b) {
      var c = a.stateNode;
      if (null === c) return null;
      var d = Db(c);
      if (null === d) return null;
      c = d[b];
      a: switch (b) {
        case "onClick":
        case "onClickCapture":
        case "onDoubleClick":
        case "onDoubleClickCapture":
        case "onMouseDown":
        case "onMouseDownCapture":
        case "onMouseMove":
        case "onMouseMoveCapture":
        case "onMouseUp":
        case "onMouseUpCapture":
        case "onMouseEnter":
          (d = !d.disabled) || (a = a.type, d = !("button" === a || "input" === a || "select" === a || "textarea" === a));
          a = !d;
          break a;
        default:
          a = false;
      }
      if (a) return null;
      if (c && "function" !== typeof c) throw Error(p(231, b, typeof c));
      return c;
    }
    var Lb = false;
    if (ia) try {
      Mb = {};
      Object.defineProperty(Mb, "passive", { get: function() {
        Lb = true;
      } });
      window.addEventListener("test", Mb, Mb);
      window.removeEventListener("test", Mb, Mb);
    } catch (a) {
      Lb = false;
    }
    var Mb;
    function Nb(a, b, c, d, e, f, g, h, k) {
      var l = Array.prototype.slice.call(arguments, 3);
      try {
        b.apply(c, l);
      } catch (m) {
        this.onError(m);
      }
    }
    var Ob = false;
    var Pb = null;
    var Qb = false;
    var Rb = null;
    var Sb = { onError: function(a) {
      Ob = true;
      Pb = a;
    } };
    function Tb(a, b, c, d, e, f, g, h, k) {
      Ob = false;
      Pb = null;
      Nb.apply(Sb, arguments);
    }
    function Ub(a, b, c, d, e, f, g, h, k) {
      Tb.apply(this, arguments);
      if (Ob) {
        if (Ob) {
          var l = Pb;
          Ob = false;
          Pb = null;
        } else throw Error(p(198));
        Qb || (Qb = true, Rb = l);
      }
    }
    function Vb(a) {
      var b = a, c = a;
      if (a.alternate) for (; b.return; ) b = b.return;
      else {
        a = b;
        do
          b = a, 0 !== (b.flags & 4098) && (c = b.return), a = b.return;
        while (a);
      }
      return 3 === b.tag ? c : null;
    }
    function Wb(a) {
      if (13 === a.tag) {
        var b = a.memoizedState;
        null === b && (a = a.alternate, null !== a && (b = a.memoizedState));
        if (null !== b) return b.dehydrated;
      }
      return null;
    }
    function Xb(a) {
      if (Vb(a) !== a) throw Error(p(188));
    }
    function Yb(a) {
      var b = a.alternate;
      if (!b) {
        b = Vb(a);
        if (null === b) throw Error(p(188));
        return b !== a ? null : a;
      }
      for (var c = a, d = b; ; ) {
        var e = c.return;
        if (null === e) break;
        var f = e.alternate;
        if (null === f) {
          d = e.return;
          if (null !== d) {
            c = d;
            continue;
          }
          break;
        }
        if (e.child === f.child) {
          for (f = e.child; f; ) {
            if (f === c) return Xb(e), a;
            if (f === d) return Xb(e), b;
            f = f.sibling;
          }
          throw Error(p(188));
        }
        if (c.return !== d.return) c = e, d = f;
        else {
          for (var g = false, h = e.child; h; ) {
            if (h === c) {
              g = true;
              c = e;
              d = f;
              break;
            }
            if (h === d) {
              g = true;
              d = e;
              c = f;
              break;
            }
            h = h.sibling;
          }
          if (!g) {
            for (h = f.child; h; ) {
              if (h === c) {
                g = true;
                c = f;
                d = e;
                break;
              }
              if (h === d) {
                g = true;
                d = f;
                c = e;
                break;
              }
              h = h.sibling;
            }
            if (!g) throw Error(p(189));
          }
        }
        if (c.alternate !== d) throw Error(p(190));
      }
      if (3 !== c.tag) throw Error(p(188));
      return c.stateNode.current === c ? a : b;
    }
    function Zb(a) {
      a = Yb(a);
      return null !== a ? $b(a) : null;
    }
    function $b(a) {
      if (5 === a.tag || 6 === a.tag) return a;
      for (a = a.child; null !== a; ) {
        var b = $b(a);
        if (null !== b) return b;
        a = a.sibling;
      }
      return null;
    }
    var ac = ca.unstable_scheduleCallback;
    var bc = ca.unstable_cancelCallback;
    var cc = ca.unstable_shouldYield;
    var dc = ca.unstable_requestPaint;
    var B = ca.unstable_now;
    var ec = ca.unstable_getCurrentPriorityLevel;
    var fc = ca.unstable_ImmediatePriority;
    var gc = ca.unstable_UserBlockingPriority;
    var hc = ca.unstable_NormalPriority;
    var ic = ca.unstable_LowPriority;
    var jc = ca.unstable_IdlePriority;
    var kc = null;
    var lc = null;
    function mc(a) {
      if (lc && "function" === typeof lc.onCommitFiberRoot) try {
        lc.onCommitFiberRoot(kc, a, void 0, 128 === (a.current.flags & 128));
      } catch (b) {
      }
    }
    var oc = Math.clz32 ? Math.clz32 : nc;
    var pc = Math.log;
    var qc = Math.LN2;
    function nc(a) {
      a >>>= 0;
      return 0 === a ? 32 : 31 - (pc(a) / qc | 0) | 0;
    }
    var rc = 64;
    var sc = 4194304;
    function tc(a) {
      switch (a & -a) {
        case 1:
          return 1;
        case 2:
          return 2;
        case 4:
          return 4;
        case 8:
          return 8;
        case 16:
          return 16;
        case 32:
          return 32;
        case 64:
        case 128:
        case 256:
        case 512:
        case 1024:
        case 2048:
        case 4096:
        case 8192:
        case 16384:
        case 32768:
        case 65536:
        case 131072:
        case 262144:
        case 524288:
        case 1048576:
        case 2097152:
          return a & 4194240;
        case 4194304:
        case 8388608:
        case 16777216:
        case 33554432:
        case 67108864:
          return a & 130023424;
        case 134217728:
          return 134217728;
        case 268435456:
          return 268435456;
        case 536870912:
          return 536870912;
        case 1073741824:
          return 1073741824;
        default:
          return a;
      }
    }
    function uc(a, b) {
      var c = a.pendingLanes;
      if (0 === c) return 0;
      var d = 0, e = a.suspendedLanes, f = a.pingedLanes, g = c & 268435455;
      if (0 !== g) {
        var h = g & ~e;
        0 !== h ? d = tc(h) : (f &= g, 0 !== f && (d = tc(f)));
      } else g = c & ~e, 0 !== g ? d = tc(g) : 0 !== f && (d = tc(f));
      if (0 === d) return 0;
      if (0 !== b && b !== d && 0 === (b & e) && (e = d & -d, f = b & -b, e >= f || 16 === e && 0 !== (f & 4194240))) return b;
      0 !== (d & 4) && (d |= c & 16);
      b = a.entangledLanes;
      if (0 !== b) for (a = a.entanglements, b &= d; 0 < b; ) c = 31 - oc(b), e = 1 << c, d |= a[c], b &= ~e;
      return d;
    }
    function vc(a, b) {
      switch (a) {
        case 1:
        case 2:
        case 4:
          return b + 250;
        case 8:
        case 16:
        case 32:
        case 64:
        case 128:
        case 256:
        case 512:
        case 1024:
        case 2048:
        case 4096:
        case 8192:
        case 16384:
        case 32768:
        case 65536:
        case 131072:
        case 262144:
        case 524288:
        case 1048576:
        case 2097152:
          return b + 5e3;
        case 4194304:
        case 8388608:
        case 16777216:
        case 33554432:
        case 67108864:
          return -1;
        case 134217728:
        case 268435456:
        case 536870912:
        case 1073741824:
          return -1;
        default:
          return -1;
      }
    }
    function wc(a, b) {
      for (var c = a.suspendedLanes, d = a.pingedLanes, e = a.expirationTimes, f = a.pendingLanes; 0 < f; ) {
        var g = 31 - oc(f), h = 1 << g, k = e[g];
        if (-1 === k) {
          if (0 === (h & c) || 0 !== (h & d)) e[g] = vc(h, b);
        } else k <= b && (a.expiredLanes |= h);
        f &= ~h;
      }
    }
    function xc(a) {
      a = a.pendingLanes & -1073741825;
      return 0 !== a ? a : a & 1073741824 ? 1073741824 : 0;
    }
    function yc() {
      var a = rc;
      rc <<= 1;
      0 === (rc & 4194240) && (rc = 64);
      return a;
    }
    function zc(a) {
      for (var b = [], c = 0; 31 > c; c++) b.push(a);
      return b;
    }
    function Ac(a, b, c) {
      a.pendingLanes |= b;
      536870912 !== b && (a.suspendedLanes = 0, a.pingedLanes = 0);
      a = a.eventTimes;
      b = 31 - oc(b);
      a[b] = c;
    }
    function Bc(a, b) {
      var c = a.pendingLanes & ~b;
      a.pendingLanes = b;
      a.suspendedLanes = 0;
      a.pingedLanes = 0;
      a.expiredLanes &= b;
      a.mutableReadLanes &= b;
      a.entangledLanes &= b;
      b = a.entanglements;
      var d = a.eventTimes;
      for (a = a.expirationTimes; 0 < c; ) {
        var e = 31 - oc(c), f = 1 << e;
        b[e] = 0;
        d[e] = -1;
        a[e] = -1;
        c &= ~f;
      }
    }
    function Cc(a, b) {
      var c = a.entangledLanes |= b;
      for (a = a.entanglements; c; ) {
        var d = 31 - oc(c), e = 1 << d;
        e & b | a[d] & b && (a[d] |= b);
        c &= ~e;
      }
    }
    var C2 = 0;
    function Dc(a) {
      a &= -a;
      return 1 < a ? 4 < a ? 0 !== (a & 268435455) ? 16 : 536870912 : 4 : 1;
    }
    var Ec;
    var Fc;
    var Gc;
    var Hc;
    var Ic;
    var Jc = false;
    var Kc = [];
    var Lc = null;
    var Mc = null;
    var Nc = null;
    var Oc = /* @__PURE__ */ new Map();
    var Pc = /* @__PURE__ */ new Map();
    var Qc = [];
    var Rc = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ");
    function Sc(a, b) {
      switch (a) {
        case "focusin":
        case "focusout":
          Lc = null;
          break;
        case "dragenter":
        case "dragleave":
          Mc = null;
          break;
        case "mouseover":
        case "mouseout":
          Nc = null;
          break;
        case "pointerover":
        case "pointerout":
          Oc.delete(b.pointerId);
          break;
        case "gotpointercapture":
        case "lostpointercapture":
          Pc.delete(b.pointerId);
      }
    }
    function Tc(a, b, c, d, e, f) {
      if (null === a || a.nativeEvent !== f) return a = { blockedOn: b, domEventName: c, eventSystemFlags: d, nativeEvent: f, targetContainers: [e] }, null !== b && (b = Cb(b), null !== b && Fc(b)), a;
      a.eventSystemFlags |= d;
      b = a.targetContainers;
      null !== e && -1 === b.indexOf(e) && b.push(e);
      return a;
    }
    function Uc(a, b, c, d, e) {
      switch (b) {
        case "focusin":
          return Lc = Tc(Lc, a, b, c, d, e), true;
        case "dragenter":
          return Mc = Tc(Mc, a, b, c, d, e), true;
        case "mouseover":
          return Nc = Tc(Nc, a, b, c, d, e), true;
        case "pointerover":
          var f = e.pointerId;
          Oc.set(f, Tc(Oc.get(f) || null, a, b, c, d, e));
          return true;
        case "gotpointercapture":
          return f = e.pointerId, Pc.set(f, Tc(Pc.get(f) || null, a, b, c, d, e)), true;
      }
      return false;
    }
    function Vc(a) {
      var b = Wc(a.target);
      if (null !== b) {
        var c = Vb(b);
        if (null !== c) {
          if (b = c.tag, 13 === b) {
            if (b = Wb(c), null !== b) {
              a.blockedOn = b;
              Ic(a.priority, function() {
                Gc(c);
              });
              return;
            }
          } else if (3 === b && c.stateNode.current.memoizedState.isDehydrated) {
            a.blockedOn = 3 === c.tag ? c.stateNode.containerInfo : null;
            return;
          }
        }
      }
      a.blockedOn = null;
    }
    function Xc(a) {
      if (null !== a.blockedOn) return false;
      for (var b = a.targetContainers; 0 < b.length; ) {
        var c = Yc(a.domEventName, a.eventSystemFlags, b[0], a.nativeEvent);
        if (null === c) {
          c = a.nativeEvent;
          var d = new c.constructor(c.type, c);
          wb = d;
          c.target.dispatchEvent(d);
          wb = null;
        } else return b = Cb(c), null !== b && Fc(b), a.blockedOn = c, false;
        b.shift();
      }
      return true;
    }
    function Zc(a, b, c) {
      Xc(a) && c.delete(b);
    }
    function $c() {
      Jc = false;
      null !== Lc && Xc(Lc) && (Lc = null);
      null !== Mc && Xc(Mc) && (Mc = null);
      null !== Nc && Xc(Nc) && (Nc = null);
      Oc.forEach(Zc);
      Pc.forEach(Zc);
    }
    function ad(a, b) {
      a.blockedOn === b && (a.blockedOn = null, Jc || (Jc = true, ca.unstable_scheduleCallback(ca.unstable_NormalPriority, $c)));
    }
    function bd(a) {
      function b(b2) {
        return ad(b2, a);
      }
      if (0 < Kc.length) {
        ad(Kc[0], a);
        for (var c = 1; c < Kc.length; c++) {
          var d = Kc[c];
          d.blockedOn === a && (d.blockedOn = null);
        }
      }
      null !== Lc && ad(Lc, a);
      null !== Mc && ad(Mc, a);
      null !== Nc && ad(Nc, a);
      Oc.forEach(b);
      Pc.forEach(b);
      for (c = 0; c < Qc.length; c++) d = Qc[c], d.blockedOn === a && (d.blockedOn = null);
      for (; 0 < Qc.length && (c = Qc[0], null === c.blockedOn); ) Vc(c), null === c.blockedOn && Qc.shift();
    }
    var cd = ua.ReactCurrentBatchConfig;
    var dd = true;
    function ed(a, b, c, d) {
      var e = C2, f = cd.transition;
      cd.transition = null;
      try {
        C2 = 1, fd(a, b, c, d);
      } finally {
        C2 = e, cd.transition = f;
      }
    }
    function gd(a, b, c, d) {
      var e = C2, f = cd.transition;
      cd.transition = null;
      try {
        C2 = 4, fd(a, b, c, d);
      } finally {
        C2 = e, cd.transition = f;
      }
    }
    function fd(a, b, c, d) {
      if (dd) {
        var e = Yc(a, b, c, d);
        if (null === e) hd(a, b, d, id, c), Sc(a, d);
        else if (Uc(e, a, b, c, d)) d.stopPropagation();
        else if (Sc(a, d), b & 4 && -1 < Rc.indexOf(a)) {
          for (; null !== e; ) {
            var f = Cb(e);
            null !== f && Ec(f);
            f = Yc(a, b, c, d);
            null === f && hd(a, b, d, id, c);
            if (f === e) break;
            e = f;
          }
          null !== e && d.stopPropagation();
        } else hd(a, b, d, null, c);
      }
    }
    var id = null;
    function Yc(a, b, c, d) {
      id = null;
      a = xb(d);
      a = Wc(a);
      if (null !== a) if (b = Vb(a), null === b) a = null;
      else if (c = b.tag, 13 === c) {
        a = Wb(b);
        if (null !== a) return a;
        a = null;
      } else if (3 === c) {
        if (b.stateNode.current.memoizedState.isDehydrated) return 3 === b.tag ? b.stateNode.containerInfo : null;
        a = null;
      } else b !== a && (a = null);
      id = a;
      return null;
    }
    function jd(a) {
      switch (a) {
        case "cancel":
        case "click":
        case "close":
        case "contextmenu":
        case "copy":
        case "cut":
        case "auxclick":
        case "dblclick":
        case "dragend":
        case "dragstart":
        case "drop":
        case "focusin":
        case "focusout":
        case "input":
        case "invalid":
        case "keydown":
        case "keypress":
        case "keyup":
        case "mousedown":
        case "mouseup":
        case "paste":
        case "pause":
        case "play":
        case "pointercancel":
        case "pointerdown":
        case "pointerup":
        case "ratechange":
        case "reset":
        case "resize":
        case "seeked":
        case "submit":
        case "touchcancel":
        case "touchend":
        case "touchstart":
        case "volumechange":
        case "change":
        case "selectionchange":
        case "textInput":
        case "compositionstart":
        case "compositionend":
        case "compositionupdate":
        case "beforeblur":
        case "afterblur":
        case "beforeinput":
        case "blur":
        case "fullscreenchange":
        case "focus":
        case "hashchange":
        case "popstate":
        case "select":
        case "selectstart":
          return 1;
        case "drag":
        case "dragenter":
        case "dragexit":
        case "dragleave":
        case "dragover":
        case "mousemove":
        case "mouseout":
        case "mouseover":
        case "pointermove":
        case "pointerout":
        case "pointerover":
        case "scroll":
        case "toggle":
        case "touchmove":
        case "wheel":
        case "mouseenter":
        case "mouseleave":
        case "pointerenter":
        case "pointerleave":
          return 4;
        case "message":
          switch (ec()) {
            case fc:
              return 1;
            case gc:
              return 4;
            case hc:
            case ic:
              return 16;
            case jc:
              return 536870912;
            default:
              return 16;
          }
        default:
          return 16;
      }
    }
    var kd = null;
    var ld = null;
    var md = null;
    function nd() {
      if (md) return md;
      var a, b = ld, c = b.length, d, e = "value" in kd ? kd.value : kd.textContent, f = e.length;
      for (a = 0; a < c && b[a] === e[a]; a++) ;
      var g = c - a;
      for (d = 1; d <= g && b[c - d] === e[f - d]; d++) ;
      return md = e.slice(a, 1 < d ? 1 - d : void 0);
    }
    function od(a) {
      var b = a.keyCode;
      "charCode" in a ? (a = a.charCode, 0 === a && 13 === b && (a = 13)) : a = b;
      10 === a && (a = 13);
      return 32 <= a || 13 === a ? a : 0;
    }
    function pd() {
      return true;
    }
    function qd() {
      return false;
    }
    function rd(a) {
      function b(b2, d, e, f, g) {
        this._reactName = b2;
        this._targetInst = e;
        this.type = d;
        this.nativeEvent = f;
        this.target = g;
        this.currentTarget = null;
        for (var c in a) a.hasOwnProperty(c) && (b2 = a[c], this[c] = b2 ? b2(f) : f[c]);
        this.isDefaultPrevented = (null != f.defaultPrevented ? f.defaultPrevented : false === f.returnValue) ? pd : qd;
        this.isPropagationStopped = qd;
        return this;
      }
      A(b.prototype, { preventDefault: function() {
        this.defaultPrevented = true;
        var a2 = this.nativeEvent;
        a2 && (a2.preventDefault ? a2.preventDefault() : "unknown" !== typeof a2.returnValue && (a2.returnValue = false), this.isDefaultPrevented = pd);
      }, stopPropagation: function() {
        var a2 = this.nativeEvent;
        a2 && (a2.stopPropagation ? a2.stopPropagation() : "unknown" !== typeof a2.cancelBubble && (a2.cancelBubble = true), this.isPropagationStopped = pd);
      }, persist: function() {
      }, isPersistent: pd });
      return b;
    }
    var sd = { eventPhase: 0, bubbles: 0, cancelable: 0, timeStamp: function(a) {
      return a.timeStamp || Date.now();
    }, defaultPrevented: 0, isTrusted: 0 };
    var td = rd(sd);
    var ud = A({}, sd, { view: 0, detail: 0 });
    var vd = rd(ud);
    var wd;
    var xd;
    var yd;
    var Ad = A({}, ud, { screenX: 0, screenY: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, getModifierState: zd, button: 0, buttons: 0, relatedTarget: function(a) {
      return void 0 === a.relatedTarget ? a.fromElement === a.srcElement ? a.toElement : a.fromElement : a.relatedTarget;
    }, movementX: function(a) {
      if ("movementX" in a) return a.movementX;
      a !== yd && (yd && "mousemove" === a.type ? (wd = a.screenX - yd.screenX, xd = a.screenY - yd.screenY) : xd = wd = 0, yd = a);
      return wd;
    }, movementY: function(a) {
      return "movementY" in a ? a.movementY : xd;
    } });
    var Bd = rd(Ad);
    var Cd = A({}, Ad, { dataTransfer: 0 });
    var Dd = rd(Cd);
    var Ed = A({}, ud, { relatedTarget: 0 });
    var Fd = rd(Ed);
    var Gd = A({}, sd, { animationName: 0, elapsedTime: 0, pseudoElement: 0 });
    var Hd = rd(Gd);
    var Id = A({}, sd, { clipboardData: function(a) {
      return "clipboardData" in a ? a.clipboardData : window.clipboardData;
    } });
    var Jd = rd(Id);
    var Kd = A({}, sd, { data: 0 });
    var Ld = rd(Kd);
    var Md = {
      Esc: "Escape",
      Spacebar: " ",
      Left: "ArrowLeft",
      Up: "ArrowUp",
      Right: "ArrowRight",
      Down: "ArrowDown",
      Del: "Delete",
      Win: "OS",
      Menu: "ContextMenu",
      Apps: "ContextMenu",
      Scroll: "ScrollLock",
      MozPrintableKey: "Unidentified"
    };
    var Nd = {
      8: "Backspace",
      9: "Tab",
      12: "Clear",
      13: "Enter",
      16: "Shift",
      17: "Control",
      18: "Alt",
      19: "Pause",
      20: "CapsLock",
      27: "Escape",
      32: " ",
      33: "PageUp",
      34: "PageDown",
      35: "End",
      36: "Home",
      37: "ArrowLeft",
      38: "ArrowUp",
      39: "ArrowRight",
      40: "ArrowDown",
      45: "Insert",
      46: "Delete",
      112: "F1",
      113: "F2",
      114: "F3",
      115: "F4",
      116: "F5",
      117: "F6",
      118: "F7",
      119: "F8",
      120: "F9",
      121: "F10",
      122: "F11",
      123: "F12",
      144: "NumLock",
      145: "ScrollLock",
      224: "Meta"
    };
    var Od = { Alt: "altKey", Control: "ctrlKey", Meta: "metaKey", Shift: "shiftKey" };
    function Pd(a) {
      var b = this.nativeEvent;
      return b.getModifierState ? b.getModifierState(a) : (a = Od[a]) ? !!b[a] : false;
    }
    function zd() {
      return Pd;
    }
    var Qd = A({}, ud, { key: function(a) {
      if (a.key) {
        var b = Md[a.key] || a.key;
        if ("Unidentified" !== b) return b;
      }
      return "keypress" === a.type ? (a = od(a), 13 === a ? "Enter" : String.fromCharCode(a)) : "keydown" === a.type || "keyup" === a.type ? Nd[a.keyCode] || "Unidentified" : "";
    }, code: 0, location: 0, ctrlKey: 0, shiftKey: 0, altKey: 0, metaKey: 0, repeat: 0, locale: 0, getModifierState: zd, charCode: function(a) {
      return "keypress" === a.type ? od(a) : 0;
    }, keyCode: function(a) {
      return "keydown" === a.type || "keyup" === a.type ? a.keyCode : 0;
    }, which: function(a) {
      return "keypress" === a.type ? od(a) : "keydown" === a.type || "keyup" === a.type ? a.keyCode : 0;
    } });
    var Rd = rd(Qd);
    var Sd = A({}, Ad, { pointerId: 0, width: 0, height: 0, pressure: 0, tangentialPressure: 0, tiltX: 0, tiltY: 0, twist: 0, pointerType: 0, isPrimary: 0 });
    var Td = rd(Sd);
    var Ud = A({}, ud, { touches: 0, targetTouches: 0, changedTouches: 0, altKey: 0, metaKey: 0, ctrlKey: 0, shiftKey: 0, getModifierState: zd });
    var Vd = rd(Ud);
    var Wd = A({}, sd, { propertyName: 0, elapsedTime: 0, pseudoElement: 0 });
    var Xd = rd(Wd);
    var Yd = A({}, Ad, {
      deltaX: function(a) {
        return "deltaX" in a ? a.deltaX : "wheelDeltaX" in a ? -a.wheelDeltaX : 0;
      },
      deltaY: function(a) {
        return "deltaY" in a ? a.deltaY : "wheelDeltaY" in a ? -a.wheelDeltaY : "wheelDelta" in a ? -a.wheelDelta : 0;
      },
      deltaZ: 0,
      deltaMode: 0
    });
    var Zd = rd(Yd);
    var $d = [9, 13, 27, 32];
    var ae = ia && "CompositionEvent" in window;
    var be = null;
    ia && "documentMode" in document && (be = document.documentMode);
    var ce = ia && "TextEvent" in window && !be;
    var de = ia && (!ae || be && 8 < be && 11 >= be);
    var ee = String.fromCharCode(32);
    var fe = false;
    function ge(a, b) {
      switch (a) {
        case "keyup":
          return -1 !== $d.indexOf(b.keyCode);
        case "keydown":
          return 229 !== b.keyCode;
        case "keypress":
        case "mousedown":
        case "focusout":
          return true;
        default:
          return false;
      }
    }
    function he(a) {
      a = a.detail;
      return "object" === typeof a && "data" in a ? a.data : null;
    }
    var ie = false;
    function je(a, b) {
      switch (a) {
        case "compositionend":
          return he(b);
        case "keypress":
          if (32 !== b.which) return null;
          fe = true;
          return ee;
        case "textInput":
          return a = b.data, a === ee && fe ? null : a;
        default:
          return null;
      }
    }
    function ke(a, b) {
      if (ie) return "compositionend" === a || !ae && ge(a, b) ? (a = nd(), md = ld = kd = null, ie = false, a) : null;
      switch (a) {
        case "paste":
          return null;
        case "keypress":
          if (!(b.ctrlKey || b.altKey || b.metaKey) || b.ctrlKey && b.altKey) {
            if (b.char && 1 < b.char.length) return b.char;
            if (b.which) return String.fromCharCode(b.which);
          }
          return null;
        case "compositionend":
          return de && "ko" !== b.locale ? null : b.data;
        default:
          return null;
      }
    }
    var le = { color: true, date: true, datetime: true, "datetime-local": true, email: true, month: true, number: true, password: true, range: true, search: true, tel: true, text: true, time: true, url: true, week: true };
    function me(a) {
      var b = a && a.nodeName && a.nodeName.toLowerCase();
      return "input" === b ? !!le[a.type] : "textarea" === b ? true : false;
    }
    function ne(a, b, c, d) {
      Eb(d);
      b = oe(b, "onChange");
      0 < b.length && (c = new td("onChange", "change", null, c, d), a.push({ event: c, listeners: b }));
    }
    var pe = null;
    var qe = null;
    function re(a) {
      se(a, 0);
    }
    function te(a) {
      var b = ue(a);
      if (Wa(b)) return a;
    }
    function ve(a, b) {
      if ("change" === a) return b;
    }
    var we = false;
    if (ia) {
      if (ia) {
        ye = "oninput" in document;
        if (!ye) {
          ze = document.createElement("div");
          ze.setAttribute("oninput", "return;");
          ye = "function" === typeof ze.oninput;
        }
        xe = ye;
      } else xe = false;
      we = xe && (!document.documentMode || 9 < document.documentMode);
    }
    var xe;
    var ye;
    var ze;
    function Ae() {
      pe && (pe.detachEvent("onpropertychange", Be), qe = pe = null);
    }
    function Be(a) {
      if ("value" === a.propertyName && te(qe)) {
        var b = [];
        ne(b, qe, a, xb(a));
        Jb(re, b);
      }
    }
    function Ce(a, b, c) {
      "focusin" === a ? (Ae(), pe = b, qe = c, pe.attachEvent("onpropertychange", Be)) : "focusout" === a && Ae();
    }
    function De(a) {
      if ("selectionchange" === a || "keyup" === a || "keydown" === a) return te(qe);
    }
    function Ee(a, b) {
      if ("click" === a) return te(b);
    }
    function Fe(a, b) {
      if ("input" === a || "change" === a) return te(b);
    }
    function Ge(a, b) {
      return a === b && (0 !== a || 1 / a === 1 / b) || a !== a && b !== b;
    }
    var He = "function" === typeof Object.is ? Object.is : Ge;
    function Ie(a, b) {
      if (He(a, b)) return true;
      if ("object" !== typeof a || null === a || "object" !== typeof b || null === b) return false;
      var c = Object.keys(a), d = Object.keys(b);
      if (c.length !== d.length) return false;
      for (d = 0; d < c.length; d++) {
        var e = c[d];
        if (!ja.call(b, e) || !He(a[e], b[e])) return false;
      }
      return true;
    }
    function Je(a) {
      for (; a && a.firstChild; ) a = a.firstChild;
      return a;
    }
    function Ke(a, b) {
      var c = Je(a);
      a = 0;
      for (var d; c; ) {
        if (3 === c.nodeType) {
          d = a + c.textContent.length;
          if (a <= b && d >= b) return { node: c, offset: b - a };
          a = d;
        }
        a: {
          for (; c; ) {
            if (c.nextSibling) {
              c = c.nextSibling;
              break a;
            }
            c = c.parentNode;
          }
          c = void 0;
        }
        c = Je(c);
      }
    }
    function Le(a, b) {
      return a && b ? a === b ? true : a && 3 === a.nodeType ? false : b && 3 === b.nodeType ? Le(a, b.parentNode) : "contains" in a ? a.contains(b) : a.compareDocumentPosition ? !!(a.compareDocumentPosition(b) & 16) : false : false;
    }
    function Me() {
      for (var a = window, b = Xa(); b instanceof a.HTMLIFrameElement; ) {
        try {
          var c = "string" === typeof b.contentWindow.location.href;
        } catch (d) {
          c = false;
        }
        if (c) a = b.contentWindow;
        else break;
        b = Xa(a.document);
      }
      return b;
    }
    function Ne(a) {
      var b = a && a.nodeName && a.nodeName.toLowerCase();
      return b && ("input" === b && ("text" === a.type || "search" === a.type || "tel" === a.type || "url" === a.type || "password" === a.type) || "textarea" === b || "true" === a.contentEditable);
    }
    function Oe(a) {
      var b = Me(), c = a.focusedElem, d = a.selectionRange;
      if (b !== c && c && c.ownerDocument && Le(c.ownerDocument.documentElement, c)) {
        if (null !== d && Ne(c)) {
          if (b = d.start, a = d.end, void 0 === a && (a = b), "selectionStart" in c) c.selectionStart = b, c.selectionEnd = Math.min(a, c.value.length);
          else if (a = (b = c.ownerDocument || document) && b.defaultView || window, a.getSelection) {
            a = a.getSelection();
            var e = c.textContent.length, f = Math.min(d.start, e);
            d = void 0 === d.end ? f : Math.min(d.end, e);
            !a.extend && f > d && (e = d, d = f, f = e);
            e = Ke(c, f);
            var g = Ke(
              c,
              d
            );
            e && g && (1 !== a.rangeCount || a.anchorNode !== e.node || a.anchorOffset !== e.offset || a.focusNode !== g.node || a.focusOffset !== g.offset) && (b = b.createRange(), b.setStart(e.node, e.offset), a.removeAllRanges(), f > d ? (a.addRange(b), a.extend(g.node, g.offset)) : (b.setEnd(g.node, g.offset), a.addRange(b)));
          }
        }
        b = [];
        for (a = c; a = a.parentNode; ) 1 === a.nodeType && b.push({ element: a, left: a.scrollLeft, top: a.scrollTop });
        "function" === typeof c.focus && c.focus();
        for (c = 0; c < b.length; c++) a = b[c], a.element.scrollLeft = a.left, a.element.scrollTop = a.top;
      }
    }
    var Pe = ia && "documentMode" in document && 11 >= document.documentMode;
    var Qe = null;
    var Re = null;
    var Se = null;
    var Te = false;
    function Ue(a, b, c) {
      var d = c.window === c ? c.document : 9 === c.nodeType ? c : c.ownerDocument;
      Te || null == Qe || Qe !== Xa(d) || (d = Qe, "selectionStart" in d && Ne(d) ? d = { start: d.selectionStart, end: d.selectionEnd } : (d = (d.ownerDocument && d.ownerDocument.defaultView || window).getSelection(), d = { anchorNode: d.anchorNode, anchorOffset: d.anchorOffset, focusNode: d.focusNode, focusOffset: d.focusOffset }), Se && Ie(Se, d) || (Se = d, d = oe(Re, "onSelect"), 0 < d.length && (b = new td("onSelect", "select", null, b, c), a.push({ event: b, listeners: d }), b.target = Qe)));
    }
    function Ve(a, b) {
      var c = {};
      c[a.toLowerCase()] = b.toLowerCase();
      c["Webkit" + a] = "webkit" + b;
      c["Moz" + a] = "moz" + b;
      return c;
    }
    var We = { animationend: Ve("Animation", "AnimationEnd"), animationiteration: Ve("Animation", "AnimationIteration"), animationstart: Ve("Animation", "AnimationStart"), transitionend: Ve("Transition", "TransitionEnd") };
    var Xe = {};
    var Ye = {};
    ia && (Ye = document.createElement("div").style, "AnimationEvent" in window || (delete We.animationend.animation, delete We.animationiteration.animation, delete We.animationstart.animation), "TransitionEvent" in window || delete We.transitionend.transition);
    function Ze(a) {
      if (Xe[a]) return Xe[a];
      if (!We[a]) return a;
      var b = We[a], c;
      for (c in b) if (b.hasOwnProperty(c) && c in Ye) return Xe[a] = b[c];
      return a;
    }
    var $e = Ze("animationend");
    var af = Ze("animationiteration");
    var bf = Ze("animationstart");
    var cf = Ze("transitionend");
    var df = /* @__PURE__ */ new Map();
    var ef = "abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");
    function ff(a, b) {
      df.set(a, b);
      fa(b, [a]);
    }
    for (gf = 0; gf < ef.length; gf++) {
      hf = ef[gf], jf = hf.toLowerCase(), kf = hf[0].toUpperCase() + hf.slice(1);
      ff(jf, "on" + kf);
    }
    var hf;
    var jf;
    var kf;
    var gf;
    ff($e, "onAnimationEnd");
    ff(af, "onAnimationIteration");
    ff(bf, "onAnimationStart");
    ff("dblclick", "onDoubleClick");
    ff("focusin", "onFocus");
    ff("focusout", "onBlur");
    ff(cf, "onTransitionEnd");
    ha("onMouseEnter", ["mouseout", "mouseover"]);
    ha("onMouseLeave", ["mouseout", "mouseover"]);
    ha("onPointerEnter", ["pointerout", "pointerover"]);
    ha("onPointerLeave", ["pointerout", "pointerover"]);
    fa("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" "));
    fa("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" "));
    fa("onBeforeInput", ["compositionend", "keypress", "textInput", "paste"]);
    fa("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" "));
    fa("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" "));
    fa("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
    var lf = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" ");
    var mf = new Set("cancel close invalid load scroll toggle".split(" ").concat(lf));
    function nf(a, b, c) {
      var d = a.type || "unknown-event";
      a.currentTarget = c;
      Ub(d, b, void 0, a);
      a.currentTarget = null;
    }
    function se(a, b) {
      b = 0 !== (b & 4);
      for (var c = 0; c < a.length; c++) {
        var d = a[c], e = d.event;
        d = d.listeners;
        a: {
          var f = void 0;
          if (b) for (var g = d.length - 1; 0 <= g; g--) {
            var h = d[g], k = h.instance, l = h.currentTarget;
            h = h.listener;
            if (k !== f && e.isPropagationStopped()) break a;
            nf(e, h, l);
            f = k;
          }
          else for (g = 0; g < d.length; g++) {
            h = d[g];
            k = h.instance;
            l = h.currentTarget;
            h = h.listener;
            if (k !== f && e.isPropagationStopped()) break a;
            nf(e, h, l);
            f = k;
          }
        }
      }
      if (Qb) throw a = Rb, Qb = false, Rb = null, a;
    }
    function D(a, b) {
      var c = b[of];
      void 0 === c && (c = b[of] = /* @__PURE__ */ new Set());
      var d = a + "__bubble";
      c.has(d) || (pf(b, a, 2, false), c.add(d));
    }
    function qf(a, b, c) {
      var d = 0;
      b && (d |= 4);
      pf(c, a, d, b);
    }
    var rf = "_reactListening" + Math.random().toString(36).slice(2);
    function sf(a) {
      if (!a[rf]) {
        a[rf] = true;
        da.forEach(function(b2) {
          "selectionchange" !== b2 && (mf.has(b2) || qf(b2, false, a), qf(b2, true, a));
        });
        var b = 9 === a.nodeType ? a : a.ownerDocument;
        null === b || b[rf] || (b[rf] = true, qf("selectionchange", false, b));
      }
    }
    function pf(a, b, c, d) {
      switch (jd(b)) {
        case 1:
          var e = ed;
          break;
        case 4:
          e = gd;
          break;
        default:
          e = fd;
      }
      c = e.bind(null, b, c, a);
      e = void 0;
      !Lb || "touchstart" !== b && "touchmove" !== b && "wheel" !== b || (e = true);
      d ? void 0 !== e ? a.addEventListener(b, c, { capture: true, passive: e }) : a.addEventListener(b, c, true) : void 0 !== e ? a.addEventListener(b, c, { passive: e }) : a.addEventListener(b, c, false);
    }
    function hd(a, b, c, d, e) {
      var f = d;
      if (0 === (b & 1) && 0 === (b & 2) && null !== d) a: for (; ; ) {
        if (null === d) return;
        var g = d.tag;
        if (3 === g || 4 === g) {
          var h = d.stateNode.containerInfo;
          if (h === e || 8 === h.nodeType && h.parentNode === e) break;
          if (4 === g) for (g = d.return; null !== g; ) {
            var k = g.tag;
            if (3 === k || 4 === k) {
              if (k = g.stateNode.containerInfo, k === e || 8 === k.nodeType && k.parentNode === e) return;
            }
            g = g.return;
          }
          for (; null !== h; ) {
            g = Wc(h);
            if (null === g) return;
            k = g.tag;
            if (5 === k || 6 === k) {
              d = f = g;
              continue a;
            }
            h = h.parentNode;
          }
        }
        d = d.return;
      }
      Jb(function() {
        var d2 = f, e2 = xb(c), g2 = [];
        a: {
          var h2 = df.get(a);
          if (void 0 !== h2) {
            var k2 = td, n = a;
            switch (a) {
              case "keypress":
                if (0 === od(c)) break a;
              case "keydown":
              case "keyup":
                k2 = Rd;
                break;
              case "focusin":
                n = "focus";
                k2 = Fd;
                break;
              case "focusout":
                n = "blur";
                k2 = Fd;
                break;
              case "beforeblur":
              case "afterblur":
                k2 = Fd;
                break;
              case "click":
                if (2 === c.button) break a;
              case "auxclick":
              case "dblclick":
              case "mousedown":
              case "mousemove":
              case "mouseup":
              case "mouseout":
              case "mouseover":
              case "contextmenu":
                k2 = Bd;
                break;
              case "drag":
              case "dragend":
              case "dragenter":
              case "dragexit":
              case "dragleave":
              case "dragover":
              case "dragstart":
              case "drop":
                k2 = Dd;
                break;
              case "touchcancel":
              case "touchend":
              case "touchmove":
              case "touchstart":
                k2 = Vd;
                break;
              case $e:
              case af:
              case bf:
                k2 = Hd;
                break;
              case cf:
                k2 = Xd;
                break;
              case "scroll":
                k2 = vd;
                break;
              case "wheel":
                k2 = Zd;
                break;
              case "copy":
              case "cut":
              case "paste":
                k2 = Jd;
                break;
              case "gotpointercapture":
              case "lostpointercapture":
              case "pointercancel":
              case "pointerdown":
              case "pointermove":
              case "pointerout":
              case "pointerover":
              case "pointerup":
                k2 = Td;
            }
            var t = 0 !== (b & 4), J = !t && "scroll" === a, x = t ? null !== h2 ? h2 + "Capture" : null : h2;
            t = [];
            for (var w = d2, u; null !== w; ) {
              u = w;
              var F = u.stateNode;
              5 === u.tag && null !== F && (u = F, null !== x && (F = Kb(w, x), null != F && t.push(tf(w, F, u))));
              if (J) break;
              w = w.return;
            }
            0 < t.length && (h2 = new k2(h2, n, null, c, e2), g2.push({ event: h2, listeners: t }));
          }
        }
        if (0 === (b & 7)) {
          a: {
            h2 = "mouseover" === a || "pointerover" === a;
            k2 = "mouseout" === a || "pointerout" === a;
            if (h2 && c !== wb && (n = c.relatedTarget || c.fromElement) && (Wc(n) || n[uf])) break a;
            if (k2 || h2) {
              h2 = e2.window === e2 ? e2 : (h2 = e2.ownerDocument) ? h2.defaultView || h2.parentWindow : window;
              if (k2) {
                if (n = c.relatedTarget || c.toElement, k2 = d2, n = n ? Wc(n) : null, null !== n && (J = Vb(n), n !== J || 5 !== n.tag && 6 !== n.tag)) n = null;
              } else k2 = null, n = d2;
              if (k2 !== n) {
                t = Bd;
                F = "onMouseLeave";
                x = "onMouseEnter";
                w = "mouse";
                if ("pointerout" === a || "pointerover" === a) t = Td, F = "onPointerLeave", x = "onPointerEnter", w = "pointer";
                J = null == k2 ? h2 : ue(k2);
                u = null == n ? h2 : ue(n);
                h2 = new t(F, w + "leave", k2, c, e2);
                h2.target = J;
                h2.relatedTarget = u;
                F = null;
                Wc(e2) === d2 && (t = new t(x, w + "enter", n, c, e2), t.target = u, t.relatedTarget = J, F = t);
                J = F;
                if (k2 && n) b: {
                  t = k2;
                  x = n;
                  w = 0;
                  for (u = t; u; u = vf(u)) w++;
                  u = 0;
                  for (F = x; F; F = vf(F)) u++;
                  for (; 0 < w - u; ) t = vf(t), w--;
                  for (; 0 < u - w; ) x = vf(x), u--;
                  for (; w--; ) {
                    if (t === x || null !== x && t === x.alternate) break b;
                    t = vf(t);
                    x = vf(x);
                  }
                  t = null;
                }
                else t = null;
                null !== k2 && wf(g2, h2, k2, t, false);
                null !== n && null !== J && wf(g2, J, n, t, true);
              }
            }
          }
          a: {
            h2 = d2 ? ue(d2) : window;
            k2 = h2.nodeName && h2.nodeName.toLowerCase();
            if ("select" === k2 || "input" === k2 && "file" === h2.type) var na = ve;
            else if (me(h2)) if (we) na = Fe;
            else {
              na = De;
              var xa = Ce;
            }
            else (k2 = h2.nodeName) && "input" === k2.toLowerCase() && ("checkbox" === h2.type || "radio" === h2.type) && (na = Ee);
            if (na && (na = na(a, d2))) {
              ne(g2, na, c, e2);
              break a;
            }
            xa && xa(a, h2, d2);
            "focusout" === a && (xa = h2._wrapperState) && xa.controlled && "number" === h2.type && cb(h2, "number", h2.value);
          }
          xa = d2 ? ue(d2) : window;
          switch (a) {
            case "focusin":
              if (me(xa) || "true" === xa.contentEditable) Qe = xa, Re = d2, Se = null;
              break;
            case "focusout":
              Se = Re = Qe = null;
              break;
            case "mousedown":
              Te = true;
              break;
            case "contextmenu":
            case "mouseup":
            case "dragend":
              Te = false;
              Ue(g2, c, e2);
              break;
            case "selectionchange":
              if (Pe) break;
            case "keydown":
            case "keyup":
              Ue(g2, c, e2);
          }
          var $a;
          if (ae) b: {
            switch (a) {
              case "compositionstart":
                var ba = "onCompositionStart";
                break b;
              case "compositionend":
                ba = "onCompositionEnd";
                break b;
              case "compositionupdate":
                ba = "onCompositionUpdate";
                break b;
            }
            ba = void 0;
          }
          else ie ? ge(a, c) && (ba = "onCompositionEnd") : "keydown" === a && 229 === c.keyCode && (ba = "onCompositionStart");
          ba && (de && "ko" !== c.locale && (ie || "onCompositionStart" !== ba ? "onCompositionEnd" === ba && ie && ($a = nd()) : (kd = e2, ld = "value" in kd ? kd.value : kd.textContent, ie = true)), xa = oe(d2, ba), 0 < xa.length && (ba = new Ld(ba, a, null, c, e2), g2.push({ event: ba, listeners: xa }), $a ? ba.data = $a : ($a = he(c), null !== $a && (ba.data = $a))));
          if ($a = ce ? je(a, c) : ke(a, c)) d2 = oe(d2, "onBeforeInput"), 0 < d2.length && (e2 = new Ld("onBeforeInput", "beforeinput", null, c, e2), g2.push({ event: e2, listeners: d2 }), e2.data = $a);
        }
        se(g2, b);
      });
    }
    function tf(a, b, c) {
      return { instance: a, listener: b, currentTarget: c };
    }
    function oe(a, b) {
      for (var c = b + "Capture", d = []; null !== a; ) {
        var e = a, f = e.stateNode;
        5 === e.tag && null !== f && (e = f, f = Kb(a, c), null != f && d.unshift(tf(a, f, e)), f = Kb(a, b), null != f && d.push(tf(a, f, e)));
        a = a.return;
      }
      return d;
    }
    function vf(a) {
      if (null === a) return null;
      do
        a = a.return;
      while (a && 5 !== a.tag);
      return a ? a : null;
    }
    function wf(a, b, c, d, e) {
      for (var f = b._reactName, g = []; null !== c && c !== d; ) {
        var h = c, k = h.alternate, l = h.stateNode;
        if (null !== k && k === d) break;
        5 === h.tag && null !== l && (h = l, e ? (k = Kb(c, f), null != k && g.unshift(tf(c, k, h))) : e || (k = Kb(c, f), null != k && g.push(tf(c, k, h))));
        c = c.return;
      }
      0 !== g.length && a.push({ event: b, listeners: g });
    }
    var xf = /\r\n?/g;
    var yf = /\u0000|\uFFFD/g;
    function zf(a) {
      return ("string" === typeof a ? a : "" + a).replace(xf, "\n").replace(yf, "");
    }
    function Af(a, b, c) {
      b = zf(b);
      if (zf(a) !== b && c) throw Error(p(425));
    }
    function Bf() {
    }
    var Cf = null;
    var Df = null;
    function Ef(a, b) {
      return "textarea" === a || "noscript" === a || "string" === typeof b.children || "number" === typeof b.children || "object" === typeof b.dangerouslySetInnerHTML && null !== b.dangerouslySetInnerHTML && null != b.dangerouslySetInnerHTML.__html;
    }
    var Ff = "function" === typeof setTimeout ? setTimeout : void 0;
    var Gf = "function" === typeof clearTimeout ? clearTimeout : void 0;
    var Hf = "function" === typeof Promise ? Promise : void 0;
    var Jf = "function" === typeof queueMicrotask ? queueMicrotask : "undefined" !== typeof Hf ? function(a) {
      return Hf.resolve(null).then(a).catch(If);
    } : Ff;
    function If(a) {
      setTimeout(function() {
        throw a;
      });
    }
    function Kf(a, b) {
      var c = b, d = 0;
      do {
        var e = c.nextSibling;
        a.removeChild(c);
        if (e && 8 === e.nodeType) if (c = e.data, "/$" === c) {
          if (0 === d) {
            a.removeChild(e);
            bd(b);
            return;
          }
          d--;
        } else "$" !== c && "$?" !== c && "$!" !== c || d++;
        c = e;
      } while (c);
      bd(b);
    }
    function Lf(a) {
      for (; null != a; a = a.nextSibling) {
        var b = a.nodeType;
        if (1 === b || 3 === b) break;
        if (8 === b) {
          b = a.data;
          if ("$" === b || "$!" === b || "$?" === b) break;
          if ("/$" === b) return null;
        }
      }
      return a;
    }
    function Mf(a) {
      a = a.previousSibling;
      for (var b = 0; a; ) {
        if (8 === a.nodeType) {
          var c = a.data;
          if ("$" === c || "$!" === c || "$?" === c) {
            if (0 === b) return a;
            b--;
          } else "/$" === c && b++;
        }
        a = a.previousSibling;
      }
      return null;
    }
    var Nf = Math.random().toString(36).slice(2);
    var Of = "__reactFiber$" + Nf;
    var Pf = "__reactProps$" + Nf;
    var uf = "__reactContainer$" + Nf;
    var of = "__reactEvents$" + Nf;
    var Qf = "__reactListeners$" + Nf;
    var Rf = "__reactHandles$" + Nf;
    function Wc(a) {
      var b = a[Of];
      if (b) return b;
      for (var c = a.parentNode; c; ) {
        if (b = c[uf] || c[Of]) {
          c = b.alternate;
          if (null !== b.child || null !== c && null !== c.child) for (a = Mf(a); null !== a; ) {
            if (c = a[Of]) return c;
            a = Mf(a);
          }
          return b;
        }
        a = c;
        c = a.parentNode;
      }
      return null;
    }
    function Cb(a) {
      a = a[Of] || a[uf];
      return !a || 5 !== a.tag && 6 !== a.tag && 13 !== a.tag && 3 !== a.tag ? null : a;
    }
    function ue(a) {
      if (5 === a.tag || 6 === a.tag) return a.stateNode;
      throw Error(p(33));
    }
    function Db(a) {
      return a[Pf] || null;
    }
    var Sf = [];
    var Tf = -1;
    function Uf(a) {
      return { current: a };
    }
    function E(a) {
      0 > Tf || (a.current = Sf[Tf], Sf[Tf] = null, Tf--);
    }
    function G(a, b) {
      Tf++;
      Sf[Tf] = a.current;
      a.current = b;
    }
    var Vf = {};
    var H = Uf(Vf);
    var Wf = Uf(false);
    var Xf = Vf;
    function Yf(a, b) {
      var c = a.type.contextTypes;
      if (!c) return Vf;
      var d = a.stateNode;
      if (d && d.__reactInternalMemoizedUnmaskedChildContext === b) return d.__reactInternalMemoizedMaskedChildContext;
      var e = {}, f;
      for (f in c) e[f] = b[f];
      d && (a = a.stateNode, a.__reactInternalMemoizedUnmaskedChildContext = b, a.__reactInternalMemoizedMaskedChildContext = e);
      return e;
    }
    function Zf(a) {
      a = a.childContextTypes;
      return null !== a && void 0 !== a;
    }
    function $f() {
      E(Wf);
      E(H);
    }
    function ag(a, b, c) {
      if (H.current !== Vf) throw Error(p(168));
      G(H, b);
      G(Wf, c);
    }
    function bg(a, b, c) {
      var d = a.stateNode;
      b = b.childContextTypes;
      if ("function" !== typeof d.getChildContext) return c;
      d = d.getChildContext();
      for (var e in d) if (!(e in b)) throw Error(p(108, Ra(a) || "Unknown", e));
      return A({}, c, d);
    }
    function cg(a) {
      a = (a = a.stateNode) && a.__reactInternalMemoizedMergedChildContext || Vf;
      Xf = H.current;
      G(H, a);
      G(Wf, Wf.current);
      return true;
    }
    function dg(a, b, c) {
      var d = a.stateNode;
      if (!d) throw Error(p(169));
      c ? (a = bg(a, b, Xf), d.__reactInternalMemoizedMergedChildContext = a, E(Wf), E(H), G(H, a)) : E(Wf);
      G(Wf, c);
    }
    var eg = null;
    var fg = false;
    var gg = false;
    function hg(a) {
      null === eg ? eg = [a] : eg.push(a);
    }
    function ig(a) {
      fg = true;
      hg(a);
    }
    function jg() {
      if (!gg && null !== eg) {
        gg = true;
        var a = 0, b = C2;
        try {
          var c = eg;
          for (C2 = 1; a < c.length; a++) {
            var d = c[a];
            do
              d = d(true);
            while (null !== d);
          }
          eg = null;
          fg = false;
        } catch (e) {
          throw null !== eg && (eg = eg.slice(a + 1)), ac(fc, jg), e;
        } finally {
          C2 = b, gg = false;
        }
      }
      return null;
    }
    var kg = [];
    var lg = 0;
    var mg = null;
    var ng = 0;
    var og = [];
    var pg = 0;
    var qg = null;
    var rg = 1;
    var sg = "";
    function tg(a, b) {
      kg[lg++] = ng;
      kg[lg++] = mg;
      mg = a;
      ng = b;
    }
    function ug(a, b, c) {
      og[pg++] = rg;
      og[pg++] = sg;
      og[pg++] = qg;
      qg = a;
      var d = rg;
      a = sg;
      var e = 32 - oc(d) - 1;
      d &= ~(1 << e);
      c += 1;
      var f = 32 - oc(b) + e;
      if (30 < f) {
        var g = e - e % 5;
        f = (d & (1 << g) - 1).toString(32);
        d >>= g;
        e -= g;
        rg = 1 << 32 - oc(b) + e | c << e | d;
        sg = f + a;
      } else rg = 1 << f | c << e | d, sg = a;
    }
    function vg(a) {
      null !== a.return && (tg(a, 1), ug(a, 1, 0));
    }
    function wg(a) {
      for (; a === mg; ) mg = kg[--lg], kg[lg] = null, ng = kg[--lg], kg[lg] = null;
      for (; a === qg; ) qg = og[--pg], og[pg] = null, sg = og[--pg], og[pg] = null, rg = og[--pg], og[pg] = null;
    }
    var xg = null;
    var yg = null;
    var I = false;
    var zg = null;
    function Ag(a, b) {
      var c = Bg(5, null, null, 0);
      c.elementType = "DELETED";
      c.stateNode = b;
      c.return = a;
      b = a.deletions;
      null === b ? (a.deletions = [c], a.flags |= 16) : b.push(c);
    }
    function Cg(a, b) {
      switch (a.tag) {
        case 5:
          var c = a.type;
          b = 1 !== b.nodeType || c.toLowerCase() !== b.nodeName.toLowerCase() ? null : b;
          return null !== b ? (a.stateNode = b, xg = a, yg = Lf(b.firstChild), true) : false;
        case 6:
          return b = "" === a.pendingProps || 3 !== b.nodeType ? null : b, null !== b ? (a.stateNode = b, xg = a, yg = null, true) : false;
        case 13:
          return b = 8 !== b.nodeType ? null : b, null !== b ? (c = null !== qg ? { id: rg, overflow: sg } : null, a.memoizedState = { dehydrated: b, treeContext: c, retryLane: 1073741824 }, c = Bg(18, null, null, 0), c.stateNode = b, c.return = a, a.child = c, xg = a, yg = null, true) : false;
        default:
          return false;
      }
    }
    function Dg(a) {
      return 0 !== (a.mode & 1) && 0 === (a.flags & 128);
    }
    function Eg(a) {
      if (I) {
        var b = yg;
        if (b) {
          var c = b;
          if (!Cg(a, b)) {
            if (Dg(a)) throw Error(p(418));
            b = Lf(c.nextSibling);
            var d = xg;
            b && Cg(a, b) ? Ag(d, c) : (a.flags = a.flags & -4097 | 2, I = false, xg = a);
          }
        } else {
          if (Dg(a)) throw Error(p(418));
          a.flags = a.flags & -4097 | 2;
          I = false;
          xg = a;
        }
      }
    }
    function Fg(a) {
      for (a = a.return; null !== a && 5 !== a.tag && 3 !== a.tag && 13 !== a.tag; ) a = a.return;
      xg = a;
    }
    function Gg(a) {
      if (a !== xg) return false;
      if (!I) return Fg(a), I = true, false;
      var b;
      (b = 3 !== a.tag) && !(b = 5 !== a.tag) && (b = a.type, b = "head" !== b && "body" !== b && !Ef(a.type, a.memoizedProps));
      if (b && (b = yg)) {
        if (Dg(a)) throw Hg(), Error(p(418));
        for (; b; ) Ag(a, b), b = Lf(b.nextSibling);
      }
      Fg(a);
      if (13 === a.tag) {
        a = a.memoizedState;
        a = null !== a ? a.dehydrated : null;
        if (!a) throw Error(p(317));
        a: {
          a = a.nextSibling;
          for (b = 0; a; ) {
            if (8 === a.nodeType) {
              var c = a.data;
              if ("/$" === c) {
                if (0 === b) {
                  yg = Lf(a.nextSibling);
                  break a;
                }
                b--;
              } else "$" !== c && "$!" !== c && "$?" !== c || b++;
            }
            a = a.nextSibling;
          }
          yg = null;
        }
      } else yg = xg ? Lf(a.stateNode.nextSibling) : null;
      return true;
    }
    function Hg() {
      for (var a = yg; a; ) a = Lf(a.nextSibling);
    }
    function Ig() {
      yg = xg = null;
      I = false;
    }
    function Jg(a) {
      null === zg ? zg = [a] : zg.push(a);
    }
    var Kg = ua.ReactCurrentBatchConfig;
    function Lg(a, b, c) {
      a = c.ref;
      if (null !== a && "function" !== typeof a && "object" !== typeof a) {
        if (c._owner) {
          c = c._owner;
          if (c) {
            if (1 !== c.tag) throw Error(p(309));
            var d = c.stateNode;
          }
          if (!d) throw Error(p(147, a));
          var e = d, f = "" + a;
          if (null !== b && null !== b.ref && "function" === typeof b.ref && b.ref._stringRef === f) return b.ref;
          b = function(a2) {
            var b2 = e.refs;
            null === a2 ? delete b2[f] : b2[f] = a2;
          };
          b._stringRef = f;
          return b;
        }
        if ("string" !== typeof a) throw Error(p(284));
        if (!c._owner) throw Error(p(290, a));
      }
      return a;
    }
    function Mg(a, b) {
      a = Object.prototype.toString.call(b);
      throw Error(p(31, "[object Object]" === a ? "object with keys {" + Object.keys(b).join(", ") + "}" : a));
    }
    function Ng(a) {
      var b = a._init;
      return b(a._payload);
    }
    function Og(a) {
      function b(b2, c2) {
        if (a) {
          var d2 = b2.deletions;
          null === d2 ? (b2.deletions = [c2], b2.flags |= 16) : d2.push(c2);
        }
      }
      function c(c2, d2) {
        if (!a) return null;
        for (; null !== d2; ) b(c2, d2), d2 = d2.sibling;
        return null;
      }
      function d(a2, b2) {
        for (a2 = /* @__PURE__ */ new Map(); null !== b2; ) null !== b2.key ? a2.set(b2.key, b2) : a2.set(b2.index, b2), b2 = b2.sibling;
        return a2;
      }
      function e(a2, b2) {
        a2 = Pg(a2, b2);
        a2.index = 0;
        a2.sibling = null;
        return a2;
      }
      function f(b2, c2, d2) {
        b2.index = d2;
        if (!a) return b2.flags |= 1048576, c2;
        d2 = b2.alternate;
        if (null !== d2) return d2 = d2.index, d2 < c2 ? (b2.flags |= 2, c2) : d2;
        b2.flags |= 2;
        return c2;
      }
      function g(b2) {
        a && null === b2.alternate && (b2.flags |= 2);
        return b2;
      }
      function h(a2, b2, c2, d2) {
        if (null === b2 || 6 !== b2.tag) return b2 = Qg(c2, a2.mode, d2), b2.return = a2, b2;
        b2 = e(b2, c2);
        b2.return = a2;
        return b2;
      }
      function k(a2, b2, c2, d2) {
        var f2 = c2.type;
        if (f2 === ya) return m(a2, b2, c2.props.children, d2, c2.key);
        if (null !== b2 && (b2.elementType === f2 || "object" === typeof f2 && null !== f2 && f2.$$typeof === Ha && Ng(f2) === b2.type)) return d2 = e(b2, c2.props), d2.ref = Lg(a2, b2, c2), d2.return = a2, d2;
        d2 = Rg(c2.type, c2.key, c2.props, null, a2.mode, d2);
        d2.ref = Lg(a2, b2, c2);
        d2.return = a2;
        return d2;
      }
      function l(a2, b2, c2, d2) {
        if (null === b2 || 4 !== b2.tag || b2.stateNode.containerInfo !== c2.containerInfo || b2.stateNode.implementation !== c2.implementation) return b2 = Sg(c2, a2.mode, d2), b2.return = a2, b2;
        b2 = e(b2, c2.children || []);
        b2.return = a2;
        return b2;
      }
      function m(a2, b2, c2, d2, f2) {
        if (null === b2 || 7 !== b2.tag) return b2 = Tg(c2, a2.mode, d2, f2), b2.return = a2, b2;
        b2 = e(b2, c2);
        b2.return = a2;
        return b2;
      }
      function q(a2, b2, c2) {
        if ("string" === typeof b2 && "" !== b2 || "number" === typeof b2) return b2 = Qg("" + b2, a2.mode, c2), b2.return = a2, b2;
        if ("object" === typeof b2 && null !== b2) {
          switch (b2.$$typeof) {
            case va:
              return c2 = Rg(b2.type, b2.key, b2.props, null, a2.mode, c2), c2.ref = Lg(a2, null, b2), c2.return = a2, c2;
            case wa:
              return b2 = Sg(b2, a2.mode, c2), b2.return = a2, b2;
            case Ha:
              var d2 = b2._init;
              return q(a2, d2(b2._payload), c2);
          }
          if (eb(b2) || Ka(b2)) return b2 = Tg(b2, a2.mode, c2, null), b2.return = a2, b2;
          Mg(a2, b2);
        }
        return null;
      }
      function r(a2, b2, c2, d2) {
        var e2 = null !== b2 ? b2.key : null;
        if ("string" === typeof c2 && "" !== c2 || "number" === typeof c2) return null !== e2 ? null : h(a2, b2, "" + c2, d2);
        if ("object" === typeof c2 && null !== c2) {
          switch (c2.$$typeof) {
            case va:
              return c2.key === e2 ? k(a2, b2, c2, d2) : null;
            case wa:
              return c2.key === e2 ? l(a2, b2, c2, d2) : null;
            case Ha:
              return e2 = c2._init, r(
                a2,
                b2,
                e2(c2._payload),
                d2
              );
          }
          if (eb(c2) || Ka(c2)) return null !== e2 ? null : m(a2, b2, c2, d2, null);
          Mg(a2, c2);
        }
        return null;
      }
      function y(a2, b2, c2, d2, e2) {
        if ("string" === typeof d2 && "" !== d2 || "number" === typeof d2) return a2 = a2.get(c2) || null, h(b2, a2, "" + d2, e2);
        if ("object" === typeof d2 && null !== d2) {
          switch (d2.$$typeof) {
            case va:
              return a2 = a2.get(null === d2.key ? c2 : d2.key) || null, k(b2, a2, d2, e2);
            case wa:
              return a2 = a2.get(null === d2.key ? c2 : d2.key) || null, l(b2, a2, d2, e2);
            case Ha:
              var f2 = d2._init;
              return y(a2, b2, c2, f2(d2._payload), e2);
          }
          if (eb(d2) || Ka(d2)) return a2 = a2.get(c2) || null, m(b2, a2, d2, e2, null);
          Mg(b2, d2);
        }
        return null;
      }
      function n(e2, g2, h2, k2) {
        for (var l2 = null, m2 = null, u = g2, w = g2 = 0, x = null; null !== u && w < h2.length; w++) {
          u.index > w ? (x = u, u = null) : x = u.sibling;
          var n2 = r(e2, u, h2[w], k2);
          if (null === n2) {
            null === u && (u = x);
            break;
          }
          a && u && null === n2.alternate && b(e2, u);
          g2 = f(n2, g2, w);
          null === m2 ? l2 = n2 : m2.sibling = n2;
          m2 = n2;
          u = x;
        }
        if (w === h2.length) return c(e2, u), I && tg(e2, w), l2;
        if (null === u) {
          for (; w < h2.length; w++) u = q(e2, h2[w], k2), null !== u && (g2 = f(u, g2, w), null === m2 ? l2 = u : m2.sibling = u, m2 = u);
          I && tg(e2, w);
          return l2;
        }
        for (u = d(e2, u); w < h2.length; w++) x = y(u, e2, w, h2[w], k2), null !== x && (a && null !== x.alternate && u.delete(null === x.key ? w : x.key), g2 = f(x, g2, w), null === m2 ? l2 = x : m2.sibling = x, m2 = x);
        a && u.forEach(function(a2) {
          return b(e2, a2);
        });
        I && tg(e2, w);
        return l2;
      }
      function t(e2, g2, h2, k2) {
        var l2 = Ka(h2);
        if ("function" !== typeof l2) throw Error(p(150));
        h2 = l2.call(h2);
        if (null == h2) throw Error(p(151));
        for (var u = l2 = null, m2 = g2, w = g2 = 0, x = null, n2 = h2.next(); null !== m2 && !n2.done; w++, n2 = h2.next()) {
          m2.index > w ? (x = m2, m2 = null) : x = m2.sibling;
          var t2 = r(e2, m2, n2.value, k2);
          if (null === t2) {
            null === m2 && (m2 = x);
            break;
          }
          a && m2 && null === t2.alternate && b(e2, m2);
          g2 = f(t2, g2, w);
          null === u ? l2 = t2 : u.sibling = t2;
          u = t2;
          m2 = x;
        }
        if (n2.done) return c(
          e2,
          m2
        ), I && tg(e2, w), l2;
        if (null === m2) {
          for (; !n2.done; w++, n2 = h2.next()) n2 = q(e2, n2.value, k2), null !== n2 && (g2 = f(n2, g2, w), null === u ? l2 = n2 : u.sibling = n2, u = n2);
          I && tg(e2, w);
          return l2;
        }
        for (m2 = d(e2, m2); !n2.done; w++, n2 = h2.next()) n2 = y(m2, e2, w, n2.value, k2), null !== n2 && (a && null !== n2.alternate && m2.delete(null === n2.key ? w : n2.key), g2 = f(n2, g2, w), null === u ? l2 = n2 : u.sibling = n2, u = n2);
        a && m2.forEach(function(a2) {
          return b(e2, a2);
        });
        I && tg(e2, w);
        return l2;
      }
      function J(a2, d2, f2, h2) {
        "object" === typeof f2 && null !== f2 && f2.type === ya && null === f2.key && (f2 = f2.props.children);
        if ("object" === typeof f2 && null !== f2) {
          switch (f2.$$typeof) {
            case va:
              a: {
                for (var k2 = f2.key, l2 = d2; null !== l2; ) {
                  if (l2.key === k2) {
                    k2 = f2.type;
                    if (k2 === ya) {
                      if (7 === l2.tag) {
                        c(a2, l2.sibling);
                        d2 = e(l2, f2.props.children);
                        d2.return = a2;
                        a2 = d2;
                        break a;
                      }
                    } else if (l2.elementType === k2 || "object" === typeof k2 && null !== k2 && k2.$$typeof === Ha && Ng(k2) === l2.type) {
                      c(a2, l2.sibling);
                      d2 = e(l2, f2.props);
                      d2.ref = Lg(a2, l2, f2);
                      d2.return = a2;
                      a2 = d2;
                      break a;
                    }
                    c(a2, l2);
                    break;
                  } else b(a2, l2);
                  l2 = l2.sibling;
                }
                f2.type === ya ? (d2 = Tg(f2.props.children, a2.mode, h2, f2.key), d2.return = a2, a2 = d2) : (h2 = Rg(f2.type, f2.key, f2.props, null, a2.mode, h2), h2.ref = Lg(a2, d2, f2), h2.return = a2, a2 = h2);
              }
              return g(a2);
            case wa:
              a: {
                for (l2 = f2.key; null !== d2; ) {
                  if (d2.key === l2) if (4 === d2.tag && d2.stateNode.containerInfo === f2.containerInfo && d2.stateNode.implementation === f2.implementation) {
                    c(a2, d2.sibling);
                    d2 = e(d2, f2.children || []);
                    d2.return = a2;
                    a2 = d2;
                    break a;
                  } else {
                    c(a2, d2);
                    break;
                  }
                  else b(a2, d2);
                  d2 = d2.sibling;
                }
                d2 = Sg(f2, a2.mode, h2);
                d2.return = a2;
                a2 = d2;
              }
              return g(a2);
            case Ha:
              return l2 = f2._init, J(a2, d2, l2(f2._payload), h2);
          }
          if (eb(f2)) return n(a2, d2, f2, h2);
          if (Ka(f2)) return t(a2, d2, f2, h2);
          Mg(a2, f2);
        }
        return "string" === typeof f2 && "" !== f2 || "number" === typeof f2 ? (f2 = "" + f2, null !== d2 && 6 === d2.tag ? (c(a2, d2.sibling), d2 = e(d2, f2), d2.return = a2, a2 = d2) : (c(a2, d2), d2 = Qg(f2, a2.mode, h2), d2.return = a2, a2 = d2), g(a2)) : c(a2, d2);
      }
      return J;
    }
    var Ug = Og(true);
    var Vg = Og(false);
    var Wg = Uf(null);
    var Xg = null;
    var Yg = null;
    var Zg = null;
    function $g() {
      Zg = Yg = Xg = null;
    }
    function ah(a) {
      var b = Wg.current;
      E(Wg);
      a._currentValue = b;
    }
    function bh(a, b, c) {
      for (; null !== a; ) {
        var d = a.alternate;
        (a.childLanes & b) !== b ? (a.childLanes |= b, null !== d && (d.childLanes |= b)) : null !== d && (d.childLanes & b) !== b && (d.childLanes |= b);
        if (a === c) break;
        a = a.return;
      }
    }
    function ch(a, b) {
      Xg = a;
      Zg = Yg = null;
      a = a.dependencies;
      null !== a && null !== a.firstContext && (0 !== (a.lanes & b) && (dh = true), a.firstContext = null);
    }
    function eh(a) {
      var b = a._currentValue;
      if (Zg !== a) if (a = { context: a, memoizedValue: b, next: null }, null === Yg) {
        if (null === Xg) throw Error(p(308));
        Yg = a;
        Xg.dependencies = { lanes: 0, firstContext: a };
      } else Yg = Yg.next = a;
      return b;
    }
    var fh = null;
    function gh(a) {
      null === fh ? fh = [a] : fh.push(a);
    }
    function hh(a, b, c, d) {
      var e = b.interleaved;
      null === e ? (c.next = c, gh(b)) : (c.next = e.next, e.next = c);
      b.interleaved = c;
      return ih(a, d);
    }
    function ih(a, b) {
      a.lanes |= b;
      var c = a.alternate;
      null !== c && (c.lanes |= b);
      c = a;
      for (a = a.return; null !== a; ) a.childLanes |= b, c = a.alternate, null !== c && (c.childLanes |= b), c = a, a = a.return;
      return 3 === c.tag ? c.stateNode : null;
    }
    var jh = false;
    function kh(a) {
      a.updateQueue = { baseState: a.memoizedState, firstBaseUpdate: null, lastBaseUpdate: null, shared: { pending: null, interleaved: null, lanes: 0 }, effects: null };
    }
    function lh(a, b) {
      a = a.updateQueue;
      b.updateQueue === a && (b.updateQueue = { baseState: a.baseState, firstBaseUpdate: a.firstBaseUpdate, lastBaseUpdate: a.lastBaseUpdate, shared: a.shared, effects: a.effects });
    }
    function mh(a, b) {
      return { eventTime: a, lane: b, tag: 0, payload: null, callback: null, next: null };
    }
    function nh(a, b, c) {
      var d = a.updateQueue;
      if (null === d) return null;
      d = d.shared;
      if (0 !== (K & 2)) {
        var e = d.pending;
        null === e ? b.next = b : (b.next = e.next, e.next = b);
        d.pending = b;
        return ih(a, c);
      }
      e = d.interleaved;
      null === e ? (b.next = b, gh(d)) : (b.next = e.next, e.next = b);
      d.interleaved = b;
      return ih(a, c);
    }
    function oh(a, b, c) {
      b = b.updateQueue;
      if (null !== b && (b = b.shared, 0 !== (c & 4194240))) {
        var d = b.lanes;
        d &= a.pendingLanes;
        c |= d;
        b.lanes = c;
        Cc(a, c);
      }
    }
    function ph(a, b) {
      var c = a.updateQueue, d = a.alternate;
      if (null !== d && (d = d.updateQueue, c === d)) {
        var e = null, f = null;
        c = c.firstBaseUpdate;
        if (null !== c) {
          do {
            var g = { eventTime: c.eventTime, lane: c.lane, tag: c.tag, payload: c.payload, callback: c.callback, next: null };
            null === f ? e = f = g : f = f.next = g;
            c = c.next;
          } while (null !== c);
          null === f ? e = f = b : f = f.next = b;
        } else e = f = b;
        c = { baseState: d.baseState, firstBaseUpdate: e, lastBaseUpdate: f, shared: d.shared, effects: d.effects };
        a.updateQueue = c;
        return;
      }
      a = c.lastBaseUpdate;
      null === a ? c.firstBaseUpdate = b : a.next = b;
      c.lastBaseUpdate = b;
    }
    function qh(a, b, c, d) {
      var e = a.updateQueue;
      jh = false;
      var f = e.firstBaseUpdate, g = e.lastBaseUpdate, h = e.shared.pending;
      if (null !== h) {
        e.shared.pending = null;
        var k = h, l = k.next;
        k.next = null;
        null === g ? f = l : g.next = l;
        g = k;
        var m = a.alternate;
        null !== m && (m = m.updateQueue, h = m.lastBaseUpdate, h !== g && (null === h ? m.firstBaseUpdate = l : h.next = l, m.lastBaseUpdate = k));
      }
      if (null !== f) {
        var q = e.baseState;
        g = 0;
        m = l = k = null;
        h = f;
        do {
          var r = h.lane, y = h.eventTime;
          if ((d & r) === r) {
            null !== m && (m = m.next = {
              eventTime: y,
              lane: 0,
              tag: h.tag,
              payload: h.payload,
              callback: h.callback,
              next: null
            });
            a: {
              var n = a, t = h;
              r = b;
              y = c;
              switch (t.tag) {
                case 1:
                  n = t.payload;
                  if ("function" === typeof n) {
                    q = n.call(y, q, r);
                    break a;
                  }
                  q = n;
                  break a;
                case 3:
                  n.flags = n.flags & -65537 | 128;
                case 0:
                  n = t.payload;
                  r = "function" === typeof n ? n.call(y, q, r) : n;
                  if (null === r || void 0 === r) break a;
                  q = A({}, q, r);
                  break a;
                case 2:
                  jh = true;
              }
            }
            null !== h.callback && 0 !== h.lane && (a.flags |= 64, r = e.effects, null === r ? e.effects = [h] : r.push(h));
          } else y = { eventTime: y, lane: r, tag: h.tag, payload: h.payload, callback: h.callback, next: null }, null === m ? (l = m = y, k = q) : m = m.next = y, g |= r;
          h = h.next;
          if (null === h) if (h = e.shared.pending, null === h) break;
          else r = h, h = r.next, r.next = null, e.lastBaseUpdate = r, e.shared.pending = null;
        } while (1);
        null === m && (k = q);
        e.baseState = k;
        e.firstBaseUpdate = l;
        e.lastBaseUpdate = m;
        b = e.shared.interleaved;
        if (null !== b) {
          e = b;
          do
            g |= e.lane, e = e.next;
          while (e !== b);
        } else null === f && (e.shared.lanes = 0);
        rh |= g;
        a.lanes = g;
        a.memoizedState = q;
      }
    }
    function sh(a, b, c) {
      a = b.effects;
      b.effects = null;
      if (null !== a) for (b = 0; b < a.length; b++) {
        var d = a[b], e = d.callback;
        if (null !== e) {
          d.callback = null;
          d = c;
          if ("function" !== typeof e) throw Error(p(191, e));
          e.call(d);
        }
      }
    }
    var th = {};
    var uh = Uf(th);
    var vh = Uf(th);
    var wh = Uf(th);
    function xh(a) {
      if (a === th) throw Error(p(174));
      return a;
    }
    function yh(a, b) {
      G(wh, b);
      G(vh, a);
      G(uh, th);
      a = b.nodeType;
      switch (a) {
        case 9:
        case 11:
          b = (b = b.documentElement) ? b.namespaceURI : lb(null, "");
          break;
        default:
          a = 8 === a ? b.parentNode : b, b = a.namespaceURI || null, a = a.tagName, b = lb(b, a);
      }
      E(uh);
      G(uh, b);
    }
    function zh() {
      E(uh);
      E(vh);
      E(wh);
    }
    function Ah(a) {
      xh(wh.current);
      var b = xh(uh.current);
      var c = lb(b, a.type);
      b !== c && (G(vh, a), G(uh, c));
    }
    function Bh(a) {
      vh.current === a && (E(uh), E(vh));
    }
    var L = Uf(0);
    function Ch(a) {
      for (var b = a; null !== b; ) {
        if (13 === b.tag) {
          var c = b.memoizedState;
          if (null !== c && (c = c.dehydrated, null === c || "$?" === c.data || "$!" === c.data)) return b;
        } else if (19 === b.tag && void 0 !== b.memoizedProps.revealOrder) {
          if (0 !== (b.flags & 128)) return b;
        } else if (null !== b.child) {
          b.child.return = b;
          b = b.child;
          continue;
        }
        if (b === a) break;
        for (; null === b.sibling; ) {
          if (null === b.return || b.return === a) return null;
          b = b.return;
        }
        b.sibling.return = b.return;
        b = b.sibling;
      }
      return null;
    }
    var Dh = [];
    function Eh() {
      for (var a = 0; a < Dh.length; a++) Dh[a]._workInProgressVersionPrimary = null;
      Dh.length = 0;
    }
    var Fh = ua.ReactCurrentDispatcher;
    var Gh = ua.ReactCurrentBatchConfig;
    var Hh = 0;
    var M = null;
    var N = null;
    var O = null;
    var Ih = false;
    var Jh = false;
    var Kh = 0;
    var Lh = 0;
    function P() {
      throw Error(p(321));
    }
    function Mh(a, b) {
      if (null === b) return false;
      for (var c = 0; c < b.length && c < a.length; c++) if (!He(a[c], b[c])) return false;
      return true;
    }
    function Nh(a, b, c, d, e, f) {
      Hh = f;
      M = b;
      b.memoizedState = null;
      b.updateQueue = null;
      b.lanes = 0;
      Fh.current = null === a || null === a.memoizedState ? Oh : Ph;
      a = c(d, e);
      if (Jh) {
        f = 0;
        do {
          Jh = false;
          Kh = 0;
          if (25 <= f) throw Error(p(301));
          f += 1;
          O = N = null;
          b.updateQueue = null;
          Fh.current = Qh;
          a = c(d, e);
        } while (Jh);
      }
      Fh.current = Rh;
      b = null !== N && null !== N.next;
      Hh = 0;
      O = N = M = null;
      Ih = false;
      if (b) throw Error(p(300));
      return a;
    }
    function Sh() {
      var a = 0 !== Kh;
      Kh = 0;
      return a;
    }
    function Th() {
      var a = { memoizedState: null, baseState: null, baseQueue: null, queue: null, next: null };
      null === O ? M.memoizedState = O = a : O = O.next = a;
      return O;
    }
    function Uh() {
      if (null === N) {
        var a = M.alternate;
        a = null !== a ? a.memoizedState : null;
      } else a = N.next;
      var b = null === O ? M.memoizedState : O.next;
      if (null !== b) O = b, N = a;
      else {
        if (null === a) throw Error(p(310));
        N = a;
        a = { memoizedState: N.memoizedState, baseState: N.baseState, baseQueue: N.baseQueue, queue: N.queue, next: null };
        null === O ? M.memoizedState = O = a : O = O.next = a;
      }
      return O;
    }
    function Vh(a, b) {
      return "function" === typeof b ? b(a) : b;
    }
    function Wh(a) {
      var b = Uh(), c = b.queue;
      if (null === c) throw Error(p(311));
      c.lastRenderedReducer = a;
      var d = N, e = d.baseQueue, f = c.pending;
      if (null !== f) {
        if (null !== e) {
          var g = e.next;
          e.next = f.next;
          f.next = g;
        }
        d.baseQueue = e = f;
        c.pending = null;
      }
      if (null !== e) {
        f = e.next;
        d = d.baseState;
        var h = g = null, k = null, l = f;
        do {
          var m = l.lane;
          if ((Hh & m) === m) null !== k && (k = k.next = { lane: 0, action: l.action, hasEagerState: l.hasEagerState, eagerState: l.eagerState, next: null }), d = l.hasEagerState ? l.eagerState : a(d, l.action);
          else {
            var q = {
              lane: m,
              action: l.action,
              hasEagerState: l.hasEagerState,
              eagerState: l.eagerState,
              next: null
            };
            null === k ? (h = k = q, g = d) : k = k.next = q;
            M.lanes |= m;
            rh |= m;
          }
          l = l.next;
        } while (null !== l && l !== f);
        null === k ? g = d : k.next = h;
        He(d, b.memoizedState) || (dh = true);
        b.memoizedState = d;
        b.baseState = g;
        b.baseQueue = k;
        c.lastRenderedState = d;
      }
      a = c.interleaved;
      if (null !== a) {
        e = a;
        do
          f = e.lane, M.lanes |= f, rh |= f, e = e.next;
        while (e !== a);
      } else null === e && (c.lanes = 0);
      return [b.memoizedState, c.dispatch];
    }
    function Xh(a) {
      var b = Uh(), c = b.queue;
      if (null === c) throw Error(p(311));
      c.lastRenderedReducer = a;
      var d = c.dispatch, e = c.pending, f = b.memoizedState;
      if (null !== e) {
        c.pending = null;
        var g = e = e.next;
        do
          f = a(f, g.action), g = g.next;
        while (g !== e);
        He(f, b.memoizedState) || (dh = true);
        b.memoizedState = f;
        null === b.baseQueue && (b.baseState = f);
        c.lastRenderedState = f;
      }
      return [f, d];
    }
    function Yh() {
    }
    function Zh(a, b) {
      var c = M, d = Uh(), e = b(), f = !He(d.memoizedState, e);
      f && (d.memoizedState = e, dh = true);
      d = d.queue;
      $h(ai.bind(null, c, d, a), [a]);
      if (d.getSnapshot !== b || f || null !== O && O.memoizedState.tag & 1) {
        c.flags |= 2048;
        bi(9, ci.bind(null, c, d, e, b), void 0, null);
        if (null === Q) throw Error(p(349));
        0 !== (Hh & 30) || di(c, b, e);
      }
      return e;
    }
    function di(a, b, c) {
      a.flags |= 16384;
      a = { getSnapshot: b, value: c };
      b = M.updateQueue;
      null === b ? (b = { lastEffect: null, stores: null }, M.updateQueue = b, b.stores = [a]) : (c = b.stores, null === c ? b.stores = [a] : c.push(a));
    }
    function ci(a, b, c, d) {
      b.value = c;
      b.getSnapshot = d;
      ei(b) && fi(a);
    }
    function ai(a, b, c) {
      return c(function() {
        ei(b) && fi(a);
      });
    }
    function ei(a) {
      var b = a.getSnapshot;
      a = a.value;
      try {
        var c = b();
        return !He(a, c);
      } catch (d) {
        return true;
      }
    }
    function fi(a) {
      var b = ih(a, 1);
      null !== b && gi(b, a, 1, -1);
    }
    function hi(a) {
      var b = Th();
      "function" === typeof a && (a = a());
      b.memoizedState = b.baseState = a;
      a = { pending: null, interleaved: null, lanes: 0, dispatch: null, lastRenderedReducer: Vh, lastRenderedState: a };
      b.queue = a;
      a = a.dispatch = ii.bind(null, M, a);
      return [b.memoizedState, a];
    }
    function bi(a, b, c, d) {
      a = { tag: a, create: b, destroy: c, deps: d, next: null };
      b = M.updateQueue;
      null === b ? (b = { lastEffect: null, stores: null }, M.updateQueue = b, b.lastEffect = a.next = a) : (c = b.lastEffect, null === c ? b.lastEffect = a.next = a : (d = c.next, c.next = a, a.next = d, b.lastEffect = a));
      return a;
    }
    function ji() {
      return Uh().memoizedState;
    }
    function ki(a, b, c, d) {
      var e = Th();
      M.flags |= a;
      e.memoizedState = bi(1 | b, c, void 0, void 0 === d ? null : d);
    }
    function li(a, b, c, d) {
      var e = Uh();
      d = void 0 === d ? null : d;
      var f = void 0;
      if (null !== N) {
        var g = N.memoizedState;
        f = g.destroy;
        if (null !== d && Mh(d, g.deps)) {
          e.memoizedState = bi(b, c, f, d);
          return;
        }
      }
      M.flags |= a;
      e.memoizedState = bi(1 | b, c, f, d);
    }
    function mi(a, b) {
      return ki(8390656, 8, a, b);
    }
    function $h(a, b) {
      return li(2048, 8, a, b);
    }
    function ni(a, b) {
      return li(4, 2, a, b);
    }
    function oi(a, b) {
      return li(4, 4, a, b);
    }
    function pi(a, b) {
      if ("function" === typeof b) return a = a(), b(a), function() {
        b(null);
      };
      if (null !== b && void 0 !== b) return a = a(), b.current = a, function() {
        b.current = null;
      };
    }
    function qi(a, b, c) {
      c = null !== c && void 0 !== c ? c.concat([a]) : null;
      return li(4, 4, pi.bind(null, b, a), c);
    }
    function ri() {
    }
    function si(a, b) {
      var c = Uh();
      b = void 0 === b ? null : b;
      var d = c.memoizedState;
      if (null !== d && null !== b && Mh(b, d[1])) return d[0];
      c.memoizedState = [a, b];
      return a;
    }
    function ti(a, b) {
      var c = Uh();
      b = void 0 === b ? null : b;
      var d = c.memoizedState;
      if (null !== d && null !== b && Mh(b, d[1])) return d[0];
      a = a();
      c.memoizedState = [a, b];
      return a;
    }
    function ui(a, b, c) {
      if (0 === (Hh & 21)) return a.baseState && (a.baseState = false, dh = true), a.memoizedState = c;
      He(c, b) || (c = yc(), M.lanes |= c, rh |= c, a.baseState = true);
      return b;
    }
    function vi(a, b) {
      var c = C2;
      C2 = 0 !== c && 4 > c ? c : 4;
      a(true);
      var d = Gh.transition;
      Gh.transition = {};
      try {
        a(false), b();
      } finally {
        C2 = c, Gh.transition = d;
      }
    }
    function wi() {
      return Uh().memoizedState;
    }
    function xi(a, b, c) {
      var d = yi(a);
      c = { lane: d, action: c, hasEagerState: false, eagerState: null, next: null };
      if (zi(a)) Ai(b, c);
      else if (c = hh(a, b, c, d), null !== c) {
        var e = R();
        gi(c, a, d, e);
        Bi(c, b, d);
      }
    }
    function ii(a, b, c) {
      var d = yi(a), e = { lane: d, action: c, hasEagerState: false, eagerState: null, next: null };
      if (zi(a)) Ai(b, e);
      else {
        var f = a.alternate;
        if (0 === a.lanes && (null === f || 0 === f.lanes) && (f = b.lastRenderedReducer, null !== f)) try {
          var g = b.lastRenderedState, h = f(g, c);
          e.hasEagerState = true;
          e.eagerState = h;
          if (He(h, g)) {
            var k = b.interleaved;
            null === k ? (e.next = e, gh(b)) : (e.next = k.next, k.next = e);
            b.interleaved = e;
            return;
          }
        } catch (l) {
        } finally {
        }
        c = hh(a, b, e, d);
        null !== c && (e = R(), gi(c, a, d, e), Bi(c, b, d));
      }
    }
    function zi(a) {
      var b = a.alternate;
      return a === M || null !== b && b === M;
    }
    function Ai(a, b) {
      Jh = Ih = true;
      var c = a.pending;
      null === c ? b.next = b : (b.next = c.next, c.next = b);
      a.pending = b;
    }
    function Bi(a, b, c) {
      if (0 !== (c & 4194240)) {
        var d = b.lanes;
        d &= a.pendingLanes;
        c |= d;
        b.lanes = c;
        Cc(a, c);
      }
    }
    var Rh = { readContext: eh, useCallback: P, useContext: P, useEffect: P, useImperativeHandle: P, useInsertionEffect: P, useLayoutEffect: P, useMemo: P, useReducer: P, useRef: P, useState: P, useDebugValue: P, useDeferredValue: P, useTransition: P, useMutableSource: P, useSyncExternalStore: P, useId: P, unstable_isNewReconciler: false };
    var Oh = { readContext: eh, useCallback: function(a, b) {
      Th().memoizedState = [a, void 0 === b ? null : b];
      return a;
    }, useContext: eh, useEffect: mi, useImperativeHandle: function(a, b, c) {
      c = null !== c && void 0 !== c ? c.concat([a]) : null;
      return ki(
        4194308,
        4,
        pi.bind(null, b, a),
        c
      );
    }, useLayoutEffect: function(a, b) {
      return ki(4194308, 4, a, b);
    }, useInsertionEffect: function(a, b) {
      return ki(4, 2, a, b);
    }, useMemo: function(a, b) {
      var c = Th();
      b = void 0 === b ? null : b;
      a = a();
      c.memoizedState = [a, b];
      return a;
    }, useReducer: function(a, b, c) {
      var d = Th();
      b = void 0 !== c ? c(b) : b;
      d.memoizedState = d.baseState = b;
      a = { pending: null, interleaved: null, lanes: 0, dispatch: null, lastRenderedReducer: a, lastRenderedState: b };
      d.queue = a;
      a = a.dispatch = xi.bind(null, M, a);
      return [d.memoizedState, a];
    }, useRef: function(a) {
      var b = Th();
      a = { current: a };
      return b.memoizedState = a;
    }, useState: hi, useDebugValue: ri, useDeferredValue: function(a) {
      return Th().memoizedState = a;
    }, useTransition: function() {
      var a = hi(false), b = a[0];
      a = vi.bind(null, a[1]);
      Th().memoizedState = a;
      return [b, a];
    }, useMutableSource: function() {
    }, useSyncExternalStore: function(a, b, c) {
      var d = M, e = Th();
      if (I) {
        if (void 0 === c) throw Error(p(407));
        c = c();
      } else {
        c = b();
        if (null === Q) throw Error(p(349));
        0 !== (Hh & 30) || di(d, b, c);
      }
      e.memoizedState = c;
      var f = { value: c, getSnapshot: b };
      e.queue = f;
      mi(ai.bind(
        null,
        d,
        f,
        a
      ), [a]);
      d.flags |= 2048;
      bi(9, ci.bind(null, d, f, c, b), void 0, null);
      return c;
    }, useId: function() {
      var a = Th(), b = Q.identifierPrefix;
      if (I) {
        var c = sg;
        var d = rg;
        c = (d & ~(1 << 32 - oc(d) - 1)).toString(32) + c;
        b = ":" + b + "R" + c;
        c = Kh++;
        0 < c && (b += "H" + c.toString(32));
        b += ":";
      } else c = Lh++, b = ":" + b + "r" + c.toString(32) + ":";
      return a.memoizedState = b;
    }, unstable_isNewReconciler: false };
    var Ph = {
      readContext: eh,
      useCallback: si,
      useContext: eh,
      useEffect: $h,
      useImperativeHandle: qi,
      useInsertionEffect: ni,
      useLayoutEffect: oi,
      useMemo: ti,
      useReducer: Wh,
      useRef: ji,
      useState: function() {
        return Wh(Vh);
      },
      useDebugValue: ri,
      useDeferredValue: function(a) {
        var b = Uh();
        return ui(b, N.memoizedState, a);
      },
      useTransition: function() {
        var a = Wh(Vh)[0], b = Uh().memoizedState;
        return [a, b];
      },
      useMutableSource: Yh,
      useSyncExternalStore: Zh,
      useId: wi,
      unstable_isNewReconciler: false
    };
    var Qh = { readContext: eh, useCallback: si, useContext: eh, useEffect: $h, useImperativeHandle: qi, useInsertionEffect: ni, useLayoutEffect: oi, useMemo: ti, useReducer: Xh, useRef: ji, useState: function() {
      return Xh(Vh);
    }, useDebugValue: ri, useDeferredValue: function(a) {
      var b = Uh();
      return null === N ? b.memoizedState = a : ui(b, N.memoizedState, a);
    }, useTransition: function() {
      var a = Xh(Vh)[0], b = Uh().memoizedState;
      return [a, b];
    }, useMutableSource: Yh, useSyncExternalStore: Zh, useId: wi, unstable_isNewReconciler: false };
    function Ci(a, b) {
      if (a && a.defaultProps) {
        b = A({}, b);
        a = a.defaultProps;
        for (var c in a) void 0 === b[c] && (b[c] = a[c]);
        return b;
      }
      return b;
    }
    function Di(a, b, c, d) {
      b = a.memoizedState;
      c = c(d, b);
      c = null === c || void 0 === c ? b : A({}, b, c);
      a.memoizedState = c;
      0 === a.lanes && (a.updateQueue.baseState = c);
    }
    var Ei = { isMounted: function(a) {
      return (a = a._reactInternals) ? Vb(a) === a : false;
    }, enqueueSetState: function(a, b, c) {
      a = a._reactInternals;
      var d = R(), e = yi(a), f = mh(d, e);
      f.payload = b;
      void 0 !== c && null !== c && (f.callback = c);
      b = nh(a, f, e);
      null !== b && (gi(b, a, e, d), oh(b, a, e));
    }, enqueueReplaceState: function(a, b, c) {
      a = a._reactInternals;
      var d = R(), e = yi(a), f = mh(d, e);
      f.tag = 1;
      f.payload = b;
      void 0 !== c && null !== c && (f.callback = c);
      b = nh(a, f, e);
      null !== b && (gi(b, a, e, d), oh(b, a, e));
    }, enqueueForceUpdate: function(a, b) {
      a = a._reactInternals;
      var c = R(), d = yi(a), e = mh(c, d);
      e.tag = 2;
      void 0 !== b && null !== b && (e.callback = b);
      b = nh(a, e, d);
      null !== b && (gi(b, a, d, c), oh(b, a, d));
    } };
    function Fi(a, b, c, d, e, f, g) {
      a = a.stateNode;
      return "function" === typeof a.shouldComponentUpdate ? a.shouldComponentUpdate(d, f, g) : b.prototype && b.prototype.isPureReactComponent ? !Ie(c, d) || !Ie(e, f) : true;
    }
    function Gi(a, b, c) {
      var d = false, e = Vf;
      var f = b.contextType;
      "object" === typeof f && null !== f ? f = eh(f) : (e = Zf(b) ? Xf : H.current, d = b.contextTypes, f = (d = null !== d && void 0 !== d) ? Yf(a, e) : Vf);
      b = new b(c, f);
      a.memoizedState = null !== b.state && void 0 !== b.state ? b.state : null;
      b.updater = Ei;
      a.stateNode = b;
      b._reactInternals = a;
      d && (a = a.stateNode, a.__reactInternalMemoizedUnmaskedChildContext = e, a.__reactInternalMemoizedMaskedChildContext = f);
      return b;
    }
    function Hi(a, b, c, d) {
      a = b.state;
      "function" === typeof b.componentWillReceiveProps && b.componentWillReceiveProps(c, d);
      "function" === typeof b.UNSAFE_componentWillReceiveProps && b.UNSAFE_componentWillReceiveProps(c, d);
      b.state !== a && Ei.enqueueReplaceState(b, b.state, null);
    }
    function Ii(a, b, c, d) {
      var e = a.stateNode;
      e.props = c;
      e.state = a.memoizedState;
      e.refs = {};
      kh(a);
      var f = b.contextType;
      "object" === typeof f && null !== f ? e.context = eh(f) : (f = Zf(b) ? Xf : H.current, e.context = Yf(a, f));
      e.state = a.memoizedState;
      f = b.getDerivedStateFromProps;
      "function" === typeof f && (Di(a, b, f, c), e.state = a.memoizedState);
      "function" === typeof b.getDerivedStateFromProps || "function" === typeof e.getSnapshotBeforeUpdate || "function" !== typeof e.UNSAFE_componentWillMount && "function" !== typeof e.componentWillMount || (b = e.state, "function" === typeof e.componentWillMount && e.componentWillMount(), "function" === typeof e.UNSAFE_componentWillMount && e.UNSAFE_componentWillMount(), b !== e.state && Ei.enqueueReplaceState(e, e.state, null), qh(a, c, e, d), e.state = a.memoizedState);
      "function" === typeof e.componentDidMount && (a.flags |= 4194308);
    }
    function Ji(a, b) {
      try {
        var c = "", d = b;
        do
          c += Pa(d), d = d.return;
        while (d);
        var e = c;
      } catch (f) {
        e = "\nError generating stack: " + f.message + "\n" + f.stack;
      }
      return { value: a, source: b, stack: e, digest: null };
    }
    function Ki(a, b, c) {
      return { value: a, source: null, stack: null != c ? c : null, digest: null != b ? b : null };
    }
    function Li(a, b) {
      try {
        console.error(b.value);
      } catch (c) {
        setTimeout(function() {
          throw c;
        });
      }
    }
    var Mi = "function" === typeof WeakMap ? WeakMap : Map;
    function Ni(a, b, c) {
      c = mh(-1, c);
      c.tag = 3;
      c.payload = { element: null };
      var d = b.value;
      c.callback = function() {
        Oi || (Oi = true, Pi = d);
        Li(a, b);
      };
      return c;
    }
    function Qi(a, b, c) {
      c = mh(-1, c);
      c.tag = 3;
      var d = a.type.getDerivedStateFromError;
      if ("function" === typeof d) {
        var e = b.value;
        c.payload = function() {
          return d(e);
        };
        c.callback = function() {
          Li(a, b);
        };
      }
      var f = a.stateNode;
      null !== f && "function" === typeof f.componentDidCatch && (c.callback = function() {
        Li(a, b);
        "function" !== typeof d && (null === Ri ? Ri = /* @__PURE__ */ new Set([this]) : Ri.add(this));
        var c2 = b.stack;
        this.componentDidCatch(b.value, { componentStack: null !== c2 ? c2 : "" });
      });
      return c;
    }
    function Si(a, b, c) {
      var d = a.pingCache;
      if (null === d) {
        d = a.pingCache = new Mi();
        var e = /* @__PURE__ */ new Set();
        d.set(b, e);
      } else e = d.get(b), void 0 === e && (e = /* @__PURE__ */ new Set(), d.set(b, e));
      e.has(c) || (e.add(c), a = Ti.bind(null, a, b, c), b.then(a, a));
    }
    function Ui(a) {
      do {
        var b;
        if (b = 13 === a.tag) b = a.memoizedState, b = null !== b ? null !== b.dehydrated ? true : false : true;
        if (b) return a;
        a = a.return;
      } while (null !== a);
      return null;
    }
    function Vi(a, b, c, d, e) {
      if (0 === (a.mode & 1)) return a === b ? a.flags |= 65536 : (a.flags |= 128, c.flags |= 131072, c.flags &= -52805, 1 === c.tag && (null === c.alternate ? c.tag = 17 : (b = mh(-1, 1), b.tag = 2, nh(c, b, 1))), c.lanes |= 1), a;
      a.flags |= 65536;
      a.lanes = e;
      return a;
    }
    var Wi = ua.ReactCurrentOwner;
    var dh = false;
    function Xi(a, b, c, d) {
      b.child = null === a ? Vg(b, null, c, d) : Ug(b, a.child, c, d);
    }
    function Yi(a, b, c, d, e) {
      c = c.render;
      var f = b.ref;
      ch(b, e);
      d = Nh(a, b, c, d, f, e);
      c = Sh();
      if (null !== a && !dh) return b.updateQueue = a.updateQueue, b.flags &= -2053, a.lanes &= ~e, Zi(a, b, e);
      I && c && vg(b);
      b.flags |= 1;
      Xi(a, b, d, e);
      return b.child;
    }
    function $i(a, b, c, d, e) {
      if (null === a) {
        var f = c.type;
        if ("function" === typeof f && !aj(f) && void 0 === f.defaultProps && null === c.compare && void 0 === c.defaultProps) return b.tag = 15, b.type = f, bj(a, b, f, d, e);
        a = Rg(c.type, null, d, b, b.mode, e);
        a.ref = b.ref;
        a.return = b;
        return b.child = a;
      }
      f = a.child;
      if (0 === (a.lanes & e)) {
        var g = f.memoizedProps;
        c = c.compare;
        c = null !== c ? c : Ie;
        if (c(g, d) && a.ref === b.ref) return Zi(a, b, e);
      }
      b.flags |= 1;
      a = Pg(f, d);
      a.ref = b.ref;
      a.return = b;
      return b.child = a;
    }
    function bj(a, b, c, d, e) {
      if (null !== a) {
        var f = a.memoizedProps;
        if (Ie(f, d) && a.ref === b.ref) if (dh = false, b.pendingProps = d = f, 0 !== (a.lanes & e)) 0 !== (a.flags & 131072) && (dh = true);
        else return b.lanes = a.lanes, Zi(a, b, e);
      }
      return cj(a, b, c, d, e);
    }
    function dj(a, b, c) {
      var d = b.pendingProps, e = d.children, f = null !== a ? a.memoizedState : null;
      if ("hidden" === d.mode) if (0 === (b.mode & 1)) b.memoizedState = { baseLanes: 0, cachePool: null, transitions: null }, G(ej, fj), fj |= c;
      else {
        if (0 === (c & 1073741824)) return a = null !== f ? f.baseLanes | c : c, b.lanes = b.childLanes = 1073741824, b.memoizedState = { baseLanes: a, cachePool: null, transitions: null }, b.updateQueue = null, G(ej, fj), fj |= a, null;
        b.memoizedState = { baseLanes: 0, cachePool: null, transitions: null };
        d = null !== f ? f.baseLanes : c;
        G(ej, fj);
        fj |= d;
      }
      else null !== f ? (d = f.baseLanes | c, b.memoizedState = null) : d = c, G(ej, fj), fj |= d;
      Xi(a, b, e, c);
      return b.child;
    }
    function gj(a, b) {
      var c = b.ref;
      if (null === a && null !== c || null !== a && a.ref !== c) b.flags |= 512, b.flags |= 2097152;
    }
    function cj(a, b, c, d, e) {
      var f = Zf(c) ? Xf : H.current;
      f = Yf(b, f);
      ch(b, e);
      c = Nh(a, b, c, d, f, e);
      d = Sh();
      if (null !== a && !dh) return b.updateQueue = a.updateQueue, b.flags &= -2053, a.lanes &= ~e, Zi(a, b, e);
      I && d && vg(b);
      b.flags |= 1;
      Xi(a, b, c, e);
      return b.child;
    }
    function hj(a, b, c, d, e) {
      if (Zf(c)) {
        var f = true;
        cg(b);
      } else f = false;
      ch(b, e);
      if (null === b.stateNode) ij(a, b), Gi(b, c, d), Ii(b, c, d, e), d = true;
      else if (null === a) {
        var g = b.stateNode, h = b.memoizedProps;
        g.props = h;
        var k = g.context, l = c.contextType;
        "object" === typeof l && null !== l ? l = eh(l) : (l = Zf(c) ? Xf : H.current, l = Yf(b, l));
        var m = c.getDerivedStateFromProps, q = "function" === typeof m || "function" === typeof g.getSnapshotBeforeUpdate;
        q || "function" !== typeof g.UNSAFE_componentWillReceiveProps && "function" !== typeof g.componentWillReceiveProps || (h !== d || k !== l) && Hi(b, g, d, l);
        jh = false;
        var r = b.memoizedState;
        g.state = r;
        qh(b, d, g, e);
        k = b.memoizedState;
        h !== d || r !== k || Wf.current || jh ? ("function" === typeof m && (Di(b, c, m, d), k = b.memoizedState), (h = jh || Fi(b, c, h, d, r, k, l)) ? (q || "function" !== typeof g.UNSAFE_componentWillMount && "function" !== typeof g.componentWillMount || ("function" === typeof g.componentWillMount && g.componentWillMount(), "function" === typeof g.UNSAFE_componentWillMount && g.UNSAFE_componentWillMount()), "function" === typeof g.componentDidMount && (b.flags |= 4194308)) : ("function" === typeof g.componentDidMount && (b.flags |= 4194308), b.memoizedProps = d, b.memoizedState = k), g.props = d, g.state = k, g.context = l, d = h) : ("function" === typeof g.componentDidMount && (b.flags |= 4194308), d = false);
      } else {
        g = b.stateNode;
        lh(a, b);
        h = b.memoizedProps;
        l = b.type === b.elementType ? h : Ci(b.type, h);
        g.props = l;
        q = b.pendingProps;
        r = g.context;
        k = c.contextType;
        "object" === typeof k && null !== k ? k = eh(k) : (k = Zf(c) ? Xf : H.current, k = Yf(b, k));
        var y = c.getDerivedStateFromProps;
        (m = "function" === typeof y || "function" === typeof g.getSnapshotBeforeUpdate) || "function" !== typeof g.UNSAFE_componentWillReceiveProps && "function" !== typeof g.componentWillReceiveProps || (h !== q || r !== k) && Hi(b, g, d, k);
        jh = false;
        r = b.memoizedState;
        g.state = r;
        qh(b, d, g, e);
        var n = b.memoizedState;
        h !== q || r !== n || Wf.current || jh ? ("function" === typeof y && (Di(b, c, y, d), n = b.memoizedState), (l = jh || Fi(b, c, l, d, r, n, k) || false) ? (m || "function" !== typeof g.UNSAFE_componentWillUpdate && "function" !== typeof g.componentWillUpdate || ("function" === typeof g.componentWillUpdate && g.componentWillUpdate(d, n, k), "function" === typeof g.UNSAFE_componentWillUpdate && g.UNSAFE_componentWillUpdate(d, n, k)), "function" === typeof g.componentDidUpdate && (b.flags |= 4), "function" === typeof g.getSnapshotBeforeUpdate && (b.flags |= 1024)) : ("function" !== typeof g.componentDidUpdate || h === a.memoizedProps && r === a.memoizedState || (b.flags |= 4), "function" !== typeof g.getSnapshotBeforeUpdate || h === a.memoizedProps && r === a.memoizedState || (b.flags |= 1024), b.memoizedProps = d, b.memoizedState = n), g.props = d, g.state = n, g.context = k, d = l) : ("function" !== typeof g.componentDidUpdate || h === a.memoizedProps && r === a.memoizedState || (b.flags |= 4), "function" !== typeof g.getSnapshotBeforeUpdate || h === a.memoizedProps && r === a.memoizedState || (b.flags |= 1024), d = false);
      }
      return jj(a, b, c, d, f, e);
    }
    function jj(a, b, c, d, e, f) {
      gj(a, b);
      var g = 0 !== (b.flags & 128);
      if (!d && !g) return e && dg(b, c, false), Zi(a, b, f);
      d = b.stateNode;
      Wi.current = b;
      var h = g && "function" !== typeof c.getDerivedStateFromError ? null : d.render();
      b.flags |= 1;
      null !== a && g ? (b.child = Ug(b, a.child, null, f), b.child = Ug(b, null, h, f)) : Xi(a, b, h, f);
      b.memoizedState = d.state;
      e && dg(b, c, true);
      return b.child;
    }
    function kj(a) {
      var b = a.stateNode;
      b.pendingContext ? ag(a, b.pendingContext, b.pendingContext !== b.context) : b.context && ag(a, b.context, false);
      yh(a, b.containerInfo);
    }
    function lj(a, b, c, d, e) {
      Ig();
      Jg(e);
      b.flags |= 256;
      Xi(a, b, c, d);
      return b.child;
    }
    var mj = { dehydrated: null, treeContext: null, retryLane: 0 };
    function nj(a) {
      return { baseLanes: a, cachePool: null, transitions: null };
    }
    function oj(a, b, c) {
      var d = b.pendingProps, e = L.current, f = false, g = 0 !== (b.flags & 128), h;
      (h = g) || (h = null !== a && null === a.memoizedState ? false : 0 !== (e & 2));
      if (h) f = true, b.flags &= -129;
      else if (null === a || null !== a.memoizedState) e |= 1;
      G(L, e & 1);
      if (null === a) {
        Eg(b);
        a = b.memoizedState;
        if (null !== a && (a = a.dehydrated, null !== a)) return 0 === (b.mode & 1) ? b.lanes = 1 : "$!" === a.data ? b.lanes = 8 : b.lanes = 1073741824, null;
        g = d.children;
        a = d.fallback;
        return f ? (d = b.mode, f = b.child, g = { mode: "hidden", children: g }, 0 === (d & 1) && null !== f ? (f.childLanes = 0, f.pendingProps = g) : f = pj(g, d, 0, null), a = Tg(a, d, c, null), f.return = b, a.return = b, f.sibling = a, b.child = f, b.child.memoizedState = nj(c), b.memoizedState = mj, a) : qj(b, g);
      }
      e = a.memoizedState;
      if (null !== e && (h = e.dehydrated, null !== h)) return rj(a, b, g, d, h, e, c);
      if (f) {
        f = d.fallback;
        g = b.mode;
        e = a.child;
        h = e.sibling;
        var k = { mode: "hidden", children: d.children };
        0 === (g & 1) && b.child !== e ? (d = b.child, d.childLanes = 0, d.pendingProps = k, b.deletions = null) : (d = Pg(e, k), d.subtreeFlags = e.subtreeFlags & 14680064);
        null !== h ? f = Pg(h, f) : (f = Tg(f, g, c, null), f.flags |= 2);
        f.return = b;
        d.return = b;
        d.sibling = f;
        b.child = d;
        d = f;
        f = b.child;
        g = a.child.memoizedState;
        g = null === g ? nj(c) : { baseLanes: g.baseLanes | c, cachePool: null, transitions: g.transitions };
        f.memoizedState = g;
        f.childLanes = a.childLanes & ~c;
        b.memoizedState = mj;
        return d;
      }
      f = a.child;
      a = f.sibling;
      d = Pg(f, { mode: "visible", children: d.children });
      0 === (b.mode & 1) && (d.lanes = c);
      d.return = b;
      d.sibling = null;
      null !== a && (c = b.deletions, null === c ? (b.deletions = [a], b.flags |= 16) : c.push(a));
      b.child = d;
      b.memoizedState = null;
      return d;
    }
    function qj(a, b) {
      b = pj({ mode: "visible", children: b }, a.mode, 0, null);
      b.return = a;
      return a.child = b;
    }
    function sj(a, b, c, d) {
      null !== d && Jg(d);
      Ug(b, a.child, null, c);
      a = qj(b, b.pendingProps.children);
      a.flags |= 2;
      b.memoizedState = null;
      return a;
    }
    function rj(a, b, c, d, e, f, g) {
      if (c) {
        if (b.flags & 256) return b.flags &= -257, d = Ki(Error(p(422))), sj(a, b, g, d);
        if (null !== b.memoizedState) return b.child = a.child, b.flags |= 128, null;
        f = d.fallback;
        e = b.mode;
        d = pj({ mode: "visible", children: d.children }, e, 0, null);
        f = Tg(f, e, g, null);
        f.flags |= 2;
        d.return = b;
        f.return = b;
        d.sibling = f;
        b.child = d;
        0 !== (b.mode & 1) && Ug(b, a.child, null, g);
        b.child.memoizedState = nj(g);
        b.memoizedState = mj;
        return f;
      }
      if (0 === (b.mode & 1)) return sj(a, b, g, null);
      if ("$!" === e.data) {
        d = e.nextSibling && e.nextSibling.dataset;
        if (d) var h = d.dgst;
        d = h;
        f = Error(p(419));
        d = Ki(f, d, void 0);
        return sj(a, b, g, d);
      }
      h = 0 !== (g & a.childLanes);
      if (dh || h) {
        d = Q;
        if (null !== d) {
          switch (g & -g) {
            case 4:
              e = 2;
              break;
            case 16:
              e = 8;
              break;
            case 64:
            case 128:
            case 256:
            case 512:
            case 1024:
            case 2048:
            case 4096:
            case 8192:
            case 16384:
            case 32768:
            case 65536:
            case 131072:
            case 262144:
            case 524288:
            case 1048576:
            case 2097152:
            case 4194304:
            case 8388608:
            case 16777216:
            case 33554432:
            case 67108864:
              e = 32;
              break;
            case 536870912:
              e = 268435456;
              break;
            default:
              e = 0;
          }
          e = 0 !== (e & (d.suspendedLanes | g)) ? 0 : e;
          0 !== e && e !== f.retryLane && (f.retryLane = e, ih(a, e), gi(d, a, e, -1));
        }
        tj();
        d = Ki(Error(p(421)));
        return sj(a, b, g, d);
      }
      if ("$?" === e.data) return b.flags |= 128, b.child = a.child, b = uj.bind(null, a), e._reactRetry = b, null;
      a = f.treeContext;
      yg = Lf(e.nextSibling);
      xg = b;
      I = true;
      zg = null;
      null !== a && (og[pg++] = rg, og[pg++] = sg, og[pg++] = qg, rg = a.id, sg = a.overflow, qg = b);
      b = qj(b, d.children);
      b.flags |= 4096;
      return b;
    }
    function vj(a, b, c) {
      a.lanes |= b;
      var d = a.alternate;
      null !== d && (d.lanes |= b);
      bh(a.return, b, c);
    }
    function wj(a, b, c, d, e) {
      var f = a.memoizedState;
      null === f ? a.memoizedState = { isBackwards: b, rendering: null, renderingStartTime: 0, last: d, tail: c, tailMode: e } : (f.isBackwards = b, f.rendering = null, f.renderingStartTime = 0, f.last = d, f.tail = c, f.tailMode = e);
    }
    function xj(a, b, c) {
      var d = b.pendingProps, e = d.revealOrder, f = d.tail;
      Xi(a, b, d.children, c);
      d = L.current;
      if (0 !== (d & 2)) d = d & 1 | 2, b.flags |= 128;
      else {
        if (null !== a && 0 !== (a.flags & 128)) a: for (a = b.child; null !== a; ) {
          if (13 === a.tag) null !== a.memoizedState && vj(a, c, b);
          else if (19 === a.tag) vj(a, c, b);
          else if (null !== a.child) {
            a.child.return = a;
            a = a.child;
            continue;
          }
          if (a === b) break a;
          for (; null === a.sibling; ) {
            if (null === a.return || a.return === b) break a;
            a = a.return;
          }
          a.sibling.return = a.return;
          a = a.sibling;
        }
        d &= 1;
      }
      G(L, d);
      if (0 === (b.mode & 1)) b.memoizedState = null;
      else switch (e) {
        case "forwards":
          c = b.child;
          for (e = null; null !== c; ) a = c.alternate, null !== a && null === Ch(a) && (e = c), c = c.sibling;
          c = e;
          null === c ? (e = b.child, b.child = null) : (e = c.sibling, c.sibling = null);
          wj(b, false, e, c, f);
          break;
        case "backwards":
          c = null;
          e = b.child;
          for (b.child = null; null !== e; ) {
            a = e.alternate;
            if (null !== a && null === Ch(a)) {
              b.child = e;
              break;
            }
            a = e.sibling;
            e.sibling = c;
            c = e;
            e = a;
          }
          wj(b, true, c, null, f);
          break;
        case "together":
          wj(b, false, null, null, void 0);
          break;
        default:
          b.memoizedState = null;
      }
      return b.child;
    }
    function ij(a, b) {
      0 === (b.mode & 1) && null !== a && (a.alternate = null, b.alternate = null, b.flags |= 2);
    }
    function Zi(a, b, c) {
      null !== a && (b.dependencies = a.dependencies);
      rh |= b.lanes;
      if (0 === (c & b.childLanes)) return null;
      if (null !== a && b.child !== a.child) throw Error(p(153));
      if (null !== b.child) {
        a = b.child;
        c = Pg(a, a.pendingProps);
        b.child = c;
        for (c.return = b; null !== a.sibling; ) a = a.sibling, c = c.sibling = Pg(a, a.pendingProps), c.return = b;
        c.sibling = null;
      }
      return b.child;
    }
    function yj(a, b, c) {
      switch (b.tag) {
        case 3:
          kj(b);
          Ig();
          break;
        case 5:
          Ah(b);
          break;
        case 1:
          Zf(b.type) && cg(b);
          break;
        case 4:
          yh(b, b.stateNode.containerInfo);
          break;
        case 10:
          var d = b.type._context, e = b.memoizedProps.value;
          G(Wg, d._currentValue);
          d._currentValue = e;
          break;
        case 13:
          d = b.memoizedState;
          if (null !== d) {
            if (null !== d.dehydrated) return G(L, L.current & 1), b.flags |= 128, null;
            if (0 !== (c & b.child.childLanes)) return oj(a, b, c);
            G(L, L.current & 1);
            a = Zi(a, b, c);
            return null !== a ? a.sibling : null;
          }
          G(L, L.current & 1);
          break;
        case 19:
          d = 0 !== (c & b.childLanes);
          if (0 !== (a.flags & 128)) {
            if (d) return xj(a, b, c);
            b.flags |= 128;
          }
          e = b.memoizedState;
          null !== e && (e.rendering = null, e.tail = null, e.lastEffect = null);
          G(L, L.current);
          if (d) break;
          else return null;
        case 22:
        case 23:
          return b.lanes = 0, dj(a, b, c);
      }
      return Zi(a, b, c);
    }
    var zj;
    var Aj;
    var Bj;
    var Cj;
    zj = function(a, b) {
      for (var c = b.child; null !== c; ) {
        if (5 === c.tag || 6 === c.tag) a.appendChild(c.stateNode);
        else if (4 !== c.tag && null !== c.child) {
          c.child.return = c;
          c = c.child;
          continue;
        }
        if (c === b) break;
        for (; null === c.sibling; ) {
          if (null === c.return || c.return === b) return;
          c = c.return;
        }
        c.sibling.return = c.return;
        c = c.sibling;
      }
    };
    Aj = function() {
    };
    Bj = function(a, b, c, d) {
      var e = a.memoizedProps;
      if (e !== d) {
        a = b.stateNode;
        xh(uh.current);
        var f = null;
        switch (c) {
          case "input":
            e = Ya(a, e);
            d = Ya(a, d);
            f = [];
            break;
          case "select":
            e = A({}, e, { value: void 0 });
            d = A({}, d, { value: void 0 });
            f = [];
            break;
          case "textarea":
            e = gb(a, e);
            d = gb(a, d);
            f = [];
            break;
          default:
            "function" !== typeof e.onClick && "function" === typeof d.onClick && (a.onclick = Bf);
        }
        ub(c, d);
        var g;
        c = null;
        for (l in e) if (!d.hasOwnProperty(l) && e.hasOwnProperty(l) && null != e[l]) if ("style" === l) {
          var h = e[l];
          for (g in h) h.hasOwnProperty(g) && (c || (c = {}), c[g] = "");
        } else "dangerouslySetInnerHTML" !== l && "children" !== l && "suppressContentEditableWarning" !== l && "suppressHydrationWarning" !== l && "autoFocus" !== l && (ea.hasOwnProperty(l) ? f || (f = []) : (f = f || []).push(l, null));
        for (l in d) {
          var k = d[l];
          h = null != e ? e[l] : void 0;
          if (d.hasOwnProperty(l) && k !== h && (null != k || null != h)) if ("style" === l) if (h) {
            for (g in h) !h.hasOwnProperty(g) || k && k.hasOwnProperty(g) || (c || (c = {}), c[g] = "");
            for (g in k) k.hasOwnProperty(g) && h[g] !== k[g] && (c || (c = {}), c[g] = k[g]);
          } else c || (f || (f = []), f.push(
            l,
            c
          )), c = k;
          else "dangerouslySetInnerHTML" === l ? (k = k ? k.__html : void 0, h = h ? h.__html : void 0, null != k && h !== k && (f = f || []).push(l, k)) : "children" === l ? "string" !== typeof k && "number" !== typeof k || (f = f || []).push(l, "" + k) : "suppressContentEditableWarning" !== l && "suppressHydrationWarning" !== l && (ea.hasOwnProperty(l) ? (null != k && "onScroll" === l && D("scroll", a), f || h === k || (f = [])) : (f = f || []).push(l, k));
        }
        c && (f = f || []).push("style", c);
        var l = f;
        if (b.updateQueue = l) b.flags |= 4;
      }
    };
    Cj = function(a, b, c, d) {
      c !== d && (b.flags |= 4);
    };
    function Dj(a, b) {
      if (!I) switch (a.tailMode) {
        case "hidden":
          b = a.tail;
          for (var c = null; null !== b; ) null !== b.alternate && (c = b), b = b.sibling;
          null === c ? a.tail = null : c.sibling = null;
          break;
        case "collapsed":
          c = a.tail;
          for (var d = null; null !== c; ) null !== c.alternate && (d = c), c = c.sibling;
          null === d ? b || null === a.tail ? a.tail = null : a.tail.sibling = null : d.sibling = null;
      }
    }
    function S(a) {
      var b = null !== a.alternate && a.alternate.child === a.child, c = 0, d = 0;
      if (b) for (var e = a.child; null !== e; ) c |= e.lanes | e.childLanes, d |= e.subtreeFlags & 14680064, d |= e.flags & 14680064, e.return = a, e = e.sibling;
      else for (e = a.child; null !== e; ) c |= e.lanes | e.childLanes, d |= e.subtreeFlags, d |= e.flags, e.return = a, e = e.sibling;
      a.subtreeFlags |= d;
      a.childLanes = c;
      return b;
    }
    function Ej(a, b, c) {
      var d = b.pendingProps;
      wg(b);
      switch (b.tag) {
        case 2:
        case 16:
        case 15:
        case 0:
        case 11:
        case 7:
        case 8:
        case 12:
        case 9:
        case 14:
          return S(b), null;
        case 1:
          return Zf(b.type) && $f(), S(b), null;
        case 3:
          d = b.stateNode;
          zh();
          E(Wf);
          E(H);
          Eh();
          d.pendingContext && (d.context = d.pendingContext, d.pendingContext = null);
          if (null === a || null === a.child) Gg(b) ? b.flags |= 4 : null === a || a.memoizedState.isDehydrated && 0 === (b.flags & 256) || (b.flags |= 1024, null !== zg && (Fj(zg), zg = null));
          Aj(a, b);
          S(b);
          return null;
        case 5:
          Bh(b);
          var e = xh(wh.current);
          c = b.type;
          if (null !== a && null != b.stateNode) Bj(a, b, c, d, e), a.ref !== b.ref && (b.flags |= 512, b.flags |= 2097152);
          else {
            if (!d) {
              if (null === b.stateNode) throw Error(p(166));
              S(b);
              return null;
            }
            a = xh(uh.current);
            if (Gg(b)) {
              d = b.stateNode;
              c = b.type;
              var f = b.memoizedProps;
              d[Of] = b;
              d[Pf] = f;
              a = 0 !== (b.mode & 1);
              switch (c) {
                case "dialog":
                  D("cancel", d);
                  D("close", d);
                  break;
                case "iframe":
                case "object":
                case "embed":
                  D("load", d);
                  break;
                case "video":
                case "audio":
                  for (e = 0; e < lf.length; e++) D(lf[e], d);
                  break;
                case "source":
                  D("error", d);
                  break;
                case "img":
                case "image":
                case "link":
                  D(
                    "error",
                    d
                  );
                  D("load", d);
                  break;
                case "details":
                  D("toggle", d);
                  break;
                case "input":
                  Za(d, f);
                  D("invalid", d);
                  break;
                case "select":
                  d._wrapperState = { wasMultiple: !!f.multiple };
                  D("invalid", d);
                  break;
                case "textarea":
                  hb(d, f), D("invalid", d);
              }
              ub(c, f);
              e = null;
              for (var g in f) if (f.hasOwnProperty(g)) {
                var h = f[g];
                "children" === g ? "string" === typeof h ? d.textContent !== h && (true !== f.suppressHydrationWarning && Af(d.textContent, h, a), e = ["children", h]) : "number" === typeof h && d.textContent !== "" + h && (true !== f.suppressHydrationWarning && Af(
                  d.textContent,
                  h,
                  a
                ), e = ["children", "" + h]) : ea.hasOwnProperty(g) && null != h && "onScroll" === g && D("scroll", d);
              }
              switch (c) {
                case "input":
                  Va(d);
                  db(d, f, true);
                  break;
                case "textarea":
                  Va(d);
                  jb(d);
                  break;
                case "select":
                case "option":
                  break;
                default:
                  "function" === typeof f.onClick && (d.onclick = Bf);
              }
              d = e;
              b.updateQueue = d;
              null !== d && (b.flags |= 4);
            } else {
              g = 9 === e.nodeType ? e : e.ownerDocument;
              "http://www.w3.org/1999/xhtml" === a && (a = kb(c));
              "http://www.w3.org/1999/xhtml" === a ? "script" === c ? (a = g.createElement("div"), a.innerHTML = "<script><\/script>", a = a.removeChild(a.firstChild)) : "string" === typeof d.is ? a = g.createElement(c, { is: d.is }) : (a = g.createElement(c), "select" === c && (g = a, d.multiple ? g.multiple = true : d.size && (g.size = d.size))) : a = g.createElementNS(a, c);
              a[Of] = b;
              a[Pf] = d;
              zj(a, b, false, false);
              b.stateNode = a;
              a: {
                g = vb(c, d);
                switch (c) {
                  case "dialog":
                    D("cancel", a);
                    D("close", a);
                    e = d;
                    break;
                  case "iframe":
                  case "object":
                  case "embed":
                    D("load", a);
                    e = d;
                    break;
                  case "video":
                  case "audio":
                    for (e = 0; e < lf.length; e++) D(lf[e], a);
                    e = d;
                    break;
                  case "source":
                    D("error", a);
                    e = d;
                    break;
                  case "img":
                  case "image":
                  case "link":
                    D(
                      "error",
                      a
                    );
                    D("load", a);
                    e = d;
                    break;
                  case "details":
                    D("toggle", a);
                    e = d;
                    break;
                  case "input":
                    Za(a, d);
                    e = Ya(a, d);
                    D("invalid", a);
                    break;
                  case "option":
                    e = d;
                    break;
                  case "select":
                    a._wrapperState = { wasMultiple: !!d.multiple };
                    e = A({}, d, { value: void 0 });
                    D("invalid", a);
                    break;
                  case "textarea":
                    hb(a, d);
                    e = gb(a, d);
                    D("invalid", a);
                    break;
                  default:
                    e = d;
                }
                ub(c, e);
                h = e;
                for (f in h) if (h.hasOwnProperty(f)) {
                  var k = h[f];
                  "style" === f ? sb(a, k) : "dangerouslySetInnerHTML" === f ? (k = k ? k.__html : void 0, null != k && nb(a, k)) : "children" === f ? "string" === typeof k ? ("textarea" !== c || "" !== k) && ob(a, k) : "number" === typeof k && ob(a, "" + k) : "suppressContentEditableWarning" !== f && "suppressHydrationWarning" !== f && "autoFocus" !== f && (ea.hasOwnProperty(f) ? null != k && "onScroll" === f && D("scroll", a) : null != k && ta(a, f, k, g));
                }
                switch (c) {
                  case "input":
                    Va(a);
                    db(a, d, false);
                    break;
                  case "textarea":
                    Va(a);
                    jb(a);
                    break;
                  case "option":
                    null != d.value && a.setAttribute("value", "" + Sa(d.value));
                    break;
                  case "select":
                    a.multiple = !!d.multiple;
                    f = d.value;
                    null != f ? fb(a, !!d.multiple, f, false) : null != d.defaultValue && fb(
                      a,
                      !!d.multiple,
                      d.defaultValue,
                      true
                    );
                    break;
                  default:
                    "function" === typeof e.onClick && (a.onclick = Bf);
                }
                switch (c) {
                  case "button":
                  case "input":
                  case "select":
                  case "textarea":
                    d = !!d.autoFocus;
                    break a;
                  case "img":
                    d = true;
                    break a;
                  default:
                    d = false;
                }
              }
              d && (b.flags |= 4);
            }
            null !== b.ref && (b.flags |= 512, b.flags |= 2097152);
          }
          S(b);
          return null;
        case 6:
          if (a && null != b.stateNode) Cj(a, b, a.memoizedProps, d);
          else {
            if ("string" !== typeof d && null === b.stateNode) throw Error(p(166));
            c = xh(wh.current);
            xh(uh.current);
            if (Gg(b)) {
              d = b.stateNode;
              c = b.memoizedProps;
              d[Of] = b;
              if (f = d.nodeValue !== c) {
                if (a = xg, null !== a) switch (a.tag) {
                  case 3:
                    Af(d.nodeValue, c, 0 !== (a.mode & 1));
                    break;
                  case 5:
                    true !== a.memoizedProps.suppressHydrationWarning && Af(d.nodeValue, c, 0 !== (a.mode & 1));
                }
              }
              f && (b.flags |= 4);
            } else d = (9 === c.nodeType ? c : c.ownerDocument).createTextNode(d), d[Of] = b, b.stateNode = d;
          }
          S(b);
          return null;
        case 13:
          E(L);
          d = b.memoizedState;
          if (null === a || null !== a.memoizedState && null !== a.memoizedState.dehydrated) {
            if (I && null !== yg && 0 !== (b.mode & 1) && 0 === (b.flags & 128)) Hg(), Ig(), b.flags |= 98560, f = false;
            else if (f = Gg(b), null !== d && null !== d.dehydrated) {
              if (null === a) {
                if (!f) throw Error(p(318));
                f = b.memoizedState;
                f = null !== f ? f.dehydrated : null;
                if (!f) throw Error(p(317));
                f[Of] = b;
              } else Ig(), 0 === (b.flags & 128) && (b.memoizedState = null), b.flags |= 4;
              S(b);
              f = false;
            } else null !== zg && (Fj(zg), zg = null), f = true;
            if (!f) return b.flags & 65536 ? b : null;
          }
          if (0 !== (b.flags & 128)) return b.lanes = c, b;
          d = null !== d;
          d !== (null !== a && null !== a.memoizedState) && d && (b.child.flags |= 8192, 0 !== (b.mode & 1) && (null === a || 0 !== (L.current & 1) ? 0 === T && (T = 3) : tj()));
          null !== b.updateQueue && (b.flags |= 4);
          S(b);
          return null;
        case 4:
          return zh(), Aj(a, b), null === a && sf(b.stateNode.containerInfo), S(b), null;
        case 10:
          return ah(b.type._context), S(b), null;
        case 17:
          return Zf(b.type) && $f(), S(b), null;
        case 19:
          E(L);
          f = b.memoizedState;
          if (null === f) return S(b), null;
          d = 0 !== (b.flags & 128);
          g = f.rendering;
          if (null === g) if (d) Dj(f, false);
          else {
            if (0 !== T || null !== a && 0 !== (a.flags & 128)) for (a = b.child; null !== a; ) {
              g = Ch(a);
              if (null !== g) {
                b.flags |= 128;
                Dj(f, false);
                d = g.updateQueue;
                null !== d && (b.updateQueue = d, b.flags |= 4);
                b.subtreeFlags = 0;
                d = c;
                for (c = b.child; null !== c; ) f = c, a = d, f.flags &= 14680066, g = f.alternate, null === g ? (f.childLanes = 0, f.lanes = a, f.child = null, f.subtreeFlags = 0, f.memoizedProps = null, f.memoizedState = null, f.updateQueue = null, f.dependencies = null, f.stateNode = null) : (f.childLanes = g.childLanes, f.lanes = g.lanes, f.child = g.child, f.subtreeFlags = 0, f.deletions = null, f.memoizedProps = g.memoizedProps, f.memoizedState = g.memoizedState, f.updateQueue = g.updateQueue, f.type = g.type, a = g.dependencies, f.dependencies = null === a ? null : { lanes: a.lanes, firstContext: a.firstContext }), c = c.sibling;
                G(L, L.current & 1 | 2);
                return b.child;
              }
              a = a.sibling;
            }
            null !== f.tail && B() > Gj && (b.flags |= 128, d = true, Dj(f, false), b.lanes = 4194304);
          }
          else {
            if (!d) if (a = Ch(g), null !== a) {
              if (b.flags |= 128, d = true, c = a.updateQueue, null !== c && (b.updateQueue = c, b.flags |= 4), Dj(f, true), null === f.tail && "hidden" === f.tailMode && !g.alternate && !I) return S(b), null;
            } else 2 * B() - f.renderingStartTime > Gj && 1073741824 !== c && (b.flags |= 128, d = true, Dj(f, false), b.lanes = 4194304);
            f.isBackwards ? (g.sibling = b.child, b.child = g) : (c = f.last, null !== c ? c.sibling = g : b.child = g, f.last = g);
          }
          if (null !== f.tail) return b = f.tail, f.rendering = b, f.tail = b.sibling, f.renderingStartTime = B(), b.sibling = null, c = L.current, G(L, d ? c & 1 | 2 : c & 1), b;
          S(b);
          return null;
        case 22:
        case 23:
          return Hj(), d = null !== b.memoizedState, null !== a && null !== a.memoizedState !== d && (b.flags |= 8192), d && 0 !== (b.mode & 1) ? 0 !== (fj & 1073741824) && (S(b), b.subtreeFlags & 6 && (b.flags |= 8192)) : S(b), null;
        case 24:
          return null;
        case 25:
          return null;
      }
      throw Error(p(156, b.tag));
    }
    function Ij(a, b) {
      wg(b);
      switch (b.tag) {
        case 1:
          return Zf(b.type) && $f(), a = b.flags, a & 65536 ? (b.flags = a & -65537 | 128, b) : null;
        case 3:
          return zh(), E(Wf), E(H), Eh(), a = b.flags, 0 !== (a & 65536) && 0 === (a & 128) ? (b.flags = a & -65537 | 128, b) : null;
        case 5:
          return Bh(b), null;
        case 13:
          E(L);
          a = b.memoizedState;
          if (null !== a && null !== a.dehydrated) {
            if (null === b.alternate) throw Error(p(340));
            Ig();
          }
          a = b.flags;
          return a & 65536 ? (b.flags = a & -65537 | 128, b) : null;
        case 19:
          return E(L), null;
        case 4:
          return zh(), null;
        case 10:
          return ah(b.type._context), null;
        case 22:
        case 23:
          return Hj(), null;
        case 24:
          return null;
        default:
          return null;
      }
    }
    var Jj = false;
    var U = false;
    var Kj = "function" === typeof WeakSet ? WeakSet : Set;
    var V = null;
    function Lj(a, b) {
      var c = a.ref;
      if (null !== c) if ("function" === typeof c) try {
        c(null);
      } catch (d) {
        W(a, b, d);
      }
      else c.current = null;
    }
    function Mj(a, b, c) {
      try {
        c();
      } catch (d) {
        W(a, b, d);
      }
    }
    var Nj = false;
    function Oj(a, b) {
      Cf = dd;
      a = Me();
      if (Ne(a)) {
        if ("selectionStart" in a) var c = { start: a.selectionStart, end: a.selectionEnd };
        else a: {
          c = (c = a.ownerDocument) && c.defaultView || window;
          var d = c.getSelection && c.getSelection();
          if (d && 0 !== d.rangeCount) {
            c = d.anchorNode;
            var e = d.anchorOffset, f = d.focusNode;
            d = d.focusOffset;
            try {
              c.nodeType, f.nodeType;
            } catch (F) {
              c = null;
              break a;
            }
            var g = 0, h = -1, k = -1, l = 0, m = 0, q = a, r = null;
            b: for (; ; ) {
              for (var y; ; ) {
                q !== c || 0 !== e && 3 !== q.nodeType || (h = g + e);
                q !== f || 0 !== d && 3 !== q.nodeType || (k = g + d);
                3 === q.nodeType && (g += q.nodeValue.length);
                if (null === (y = q.firstChild)) break;
                r = q;
                q = y;
              }
              for (; ; ) {
                if (q === a) break b;
                r === c && ++l === e && (h = g);
                r === f && ++m === d && (k = g);
                if (null !== (y = q.nextSibling)) break;
                q = r;
                r = q.parentNode;
              }
              q = y;
            }
            c = -1 === h || -1 === k ? null : { start: h, end: k };
          } else c = null;
        }
        c = c || { start: 0, end: 0 };
      } else c = null;
      Df = { focusedElem: a, selectionRange: c };
      dd = false;
      for (V = b; null !== V; ) if (b = V, a = b.child, 0 !== (b.subtreeFlags & 1028) && null !== a) a.return = b, V = a;
      else for (; null !== V; ) {
        b = V;
        try {
          var n = b.alternate;
          if (0 !== (b.flags & 1024)) switch (b.tag) {
            case 0:
            case 11:
            case 15:
              break;
            case 1:
              if (null !== n) {
                var t = n.memoizedProps, J = n.memoizedState, x = b.stateNode, w = x.getSnapshotBeforeUpdate(b.elementType === b.type ? t : Ci(b.type, t), J);
                x.__reactInternalSnapshotBeforeUpdate = w;
              }
              break;
            case 3:
              var u = b.stateNode.containerInfo;
              1 === u.nodeType ? u.textContent = "" : 9 === u.nodeType && u.documentElement && u.removeChild(u.documentElement);
              break;
            case 5:
            case 6:
            case 4:
            case 17:
              break;
            default:
              throw Error(p(163));
          }
        } catch (F) {
          W(b, b.return, F);
        }
        a = b.sibling;
        if (null !== a) {
          a.return = b.return;
          V = a;
          break;
        }
        V = b.return;
      }
      n = Nj;
      Nj = false;
      return n;
    }
    function Pj(a, b, c) {
      var d = b.updateQueue;
      d = null !== d ? d.lastEffect : null;
      if (null !== d) {
        var e = d = d.next;
        do {
          if ((e.tag & a) === a) {
            var f = e.destroy;
            e.destroy = void 0;
            void 0 !== f && Mj(b, c, f);
          }
          e = e.next;
        } while (e !== d);
      }
    }
    function Qj(a, b) {
      b = b.updateQueue;
      b = null !== b ? b.lastEffect : null;
      if (null !== b) {
        var c = b = b.next;
        do {
          if ((c.tag & a) === a) {
            var d = c.create;
            c.destroy = d();
          }
          c = c.next;
        } while (c !== b);
      }
    }
    function Rj(a) {
      var b = a.ref;
      if (null !== b) {
        var c = a.stateNode;
        switch (a.tag) {
          case 5:
            a = c;
            break;
          default:
            a = c;
        }
        "function" === typeof b ? b(a) : b.current = a;
      }
    }
    function Sj(a) {
      var b = a.alternate;
      null !== b && (a.alternate = null, Sj(b));
      a.child = null;
      a.deletions = null;
      a.sibling = null;
      5 === a.tag && (b = a.stateNode, null !== b && (delete b[Of], delete b[Pf], delete b[of], delete b[Qf], delete b[Rf]));
      a.stateNode = null;
      a.return = null;
      a.dependencies = null;
      a.memoizedProps = null;
      a.memoizedState = null;
      a.pendingProps = null;
      a.stateNode = null;
      a.updateQueue = null;
    }
    function Tj(a) {
      return 5 === a.tag || 3 === a.tag || 4 === a.tag;
    }
    function Uj(a) {
      a: for (; ; ) {
        for (; null === a.sibling; ) {
          if (null === a.return || Tj(a.return)) return null;
          a = a.return;
        }
        a.sibling.return = a.return;
        for (a = a.sibling; 5 !== a.tag && 6 !== a.tag && 18 !== a.tag; ) {
          if (a.flags & 2) continue a;
          if (null === a.child || 4 === a.tag) continue a;
          else a.child.return = a, a = a.child;
        }
        if (!(a.flags & 2)) return a.stateNode;
      }
    }
    function Vj(a, b, c) {
      var d = a.tag;
      if (5 === d || 6 === d) a = a.stateNode, b ? 8 === c.nodeType ? c.parentNode.insertBefore(a, b) : c.insertBefore(a, b) : (8 === c.nodeType ? (b = c.parentNode, b.insertBefore(a, c)) : (b = c, b.appendChild(a)), c = c._reactRootContainer, null !== c && void 0 !== c || null !== b.onclick || (b.onclick = Bf));
      else if (4 !== d && (a = a.child, null !== a)) for (Vj(a, b, c), a = a.sibling; null !== a; ) Vj(a, b, c), a = a.sibling;
    }
    function Wj(a, b, c) {
      var d = a.tag;
      if (5 === d || 6 === d) a = a.stateNode, b ? c.insertBefore(a, b) : c.appendChild(a);
      else if (4 !== d && (a = a.child, null !== a)) for (Wj(a, b, c), a = a.sibling; null !== a; ) Wj(a, b, c), a = a.sibling;
    }
    var X = null;
    var Xj = false;
    function Yj(a, b, c) {
      for (c = c.child; null !== c; ) Zj(a, b, c), c = c.sibling;
    }
    function Zj(a, b, c) {
      if (lc && "function" === typeof lc.onCommitFiberUnmount) try {
        lc.onCommitFiberUnmount(kc, c);
      } catch (h) {
      }
      switch (c.tag) {
        case 5:
          U || Lj(c, b);
        case 6:
          var d = X, e = Xj;
          X = null;
          Yj(a, b, c);
          X = d;
          Xj = e;
          null !== X && (Xj ? (a = X, c = c.stateNode, 8 === a.nodeType ? a.parentNode.removeChild(c) : a.removeChild(c)) : X.removeChild(c.stateNode));
          break;
        case 18:
          null !== X && (Xj ? (a = X, c = c.stateNode, 8 === a.nodeType ? Kf(a.parentNode, c) : 1 === a.nodeType && Kf(a, c), bd(a)) : Kf(X, c.stateNode));
          break;
        case 4:
          d = X;
          e = Xj;
          X = c.stateNode.containerInfo;
          Xj = true;
          Yj(a, b, c);
          X = d;
          Xj = e;
          break;
        case 0:
        case 11:
        case 14:
        case 15:
          if (!U && (d = c.updateQueue, null !== d && (d = d.lastEffect, null !== d))) {
            e = d = d.next;
            do {
              var f = e, g = f.destroy;
              f = f.tag;
              void 0 !== g && (0 !== (f & 2) ? Mj(c, b, g) : 0 !== (f & 4) && Mj(c, b, g));
              e = e.next;
            } while (e !== d);
          }
          Yj(a, b, c);
          break;
        case 1:
          if (!U && (Lj(c, b), d = c.stateNode, "function" === typeof d.componentWillUnmount)) try {
            d.props = c.memoizedProps, d.state = c.memoizedState, d.componentWillUnmount();
          } catch (h) {
            W(c, b, h);
          }
          Yj(a, b, c);
          break;
        case 21:
          Yj(a, b, c);
          break;
        case 22:
          c.mode & 1 ? (U = (d = U) || null !== c.memoizedState, Yj(a, b, c), U = d) : Yj(a, b, c);
          break;
        default:
          Yj(a, b, c);
      }
    }
    function ak(a) {
      var b = a.updateQueue;
      if (null !== b) {
        a.updateQueue = null;
        var c = a.stateNode;
        null === c && (c = a.stateNode = new Kj());
        b.forEach(function(b2) {
          var d = bk.bind(null, a, b2);
          c.has(b2) || (c.add(b2), b2.then(d, d));
        });
      }
    }
    function ck(a, b) {
      var c = b.deletions;
      if (null !== c) for (var d = 0; d < c.length; d++) {
        var e = c[d];
        try {
          var f = a, g = b, h = g;
          a: for (; null !== h; ) {
            switch (h.tag) {
              case 5:
                X = h.stateNode;
                Xj = false;
                break a;
              case 3:
                X = h.stateNode.containerInfo;
                Xj = true;
                break a;
              case 4:
                X = h.stateNode.containerInfo;
                Xj = true;
                break a;
            }
            h = h.return;
          }
          if (null === X) throw Error(p(160));
          Zj(f, g, e);
          X = null;
          Xj = false;
          var k = e.alternate;
          null !== k && (k.return = null);
          e.return = null;
        } catch (l) {
          W(e, b, l);
        }
      }
      if (b.subtreeFlags & 12854) for (b = b.child; null !== b; ) dk(b, a), b = b.sibling;
    }
    function dk(a, b) {
      var c = a.alternate, d = a.flags;
      switch (a.tag) {
        case 0:
        case 11:
        case 14:
        case 15:
          ck(b, a);
          ek(a);
          if (d & 4) {
            try {
              Pj(3, a, a.return), Qj(3, a);
            } catch (t) {
              W(a, a.return, t);
            }
            try {
              Pj(5, a, a.return);
            } catch (t) {
              W(a, a.return, t);
            }
          }
          break;
        case 1:
          ck(b, a);
          ek(a);
          d & 512 && null !== c && Lj(c, c.return);
          break;
        case 5:
          ck(b, a);
          ek(a);
          d & 512 && null !== c && Lj(c, c.return);
          if (a.flags & 32) {
            var e = a.stateNode;
            try {
              ob(e, "");
            } catch (t) {
              W(a, a.return, t);
            }
          }
          if (d & 4 && (e = a.stateNode, null != e)) {
            var f = a.memoizedProps, g = null !== c ? c.memoizedProps : f, h = a.type, k = a.updateQueue;
            a.updateQueue = null;
            if (null !== k) try {
              "input" === h && "radio" === f.type && null != f.name && ab(e, f);
              vb(h, g);
              var l = vb(h, f);
              for (g = 0; g < k.length; g += 2) {
                var m = k[g], q = k[g + 1];
                "style" === m ? sb(e, q) : "dangerouslySetInnerHTML" === m ? nb(e, q) : "children" === m ? ob(e, q) : ta(e, m, q, l);
              }
              switch (h) {
                case "input":
                  bb(e, f);
                  break;
                case "textarea":
                  ib(e, f);
                  break;
                case "select":
                  var r = e._wrapperState.wasMultiple;
                  e._wrapperState.wasMultiple = !!f.multiple;
                  var y = f.value;
                  null != y ? fb(e, !!f.multiple, y, false) : r !== !!f.multiple && (null != f.defaultValue ? fb(
                    e,
                    !!f.multiple,
                    f.defaultValue,
                    true
                  ) : fb(e, !!f.multiple, f.multiple ? [] : "", false));
              }
              e[Pf] = f;
            } catch (t) {
              W(a, a.return, t);
            }
          }
          break;
        case 6:
          ck(b, a);
          ek(a);
          if (d & 4) {
            if (null === a.stateNode) throw Error(p(162));
            e = a.stateNode;
            f = a.memoizedProps;
            try {
              e.nodeValue = f;
            } catch (t) {
              W(a, a.return, t);
            }
          }
          break;
        case 3:
          ck(b, a);
          ek(a);
          if (d & 4 && null !== c && c.memoizedState.isDehydrated) try {
            bd(b.containerInfo);
          } catch (t) {
            W(a, a.return, t);
          }
          break;
        case 4:
          ck(b, a);
          ek(a);
          break;
        case 13:
          ck(b, a);
          ek(a);
          e = a.child;
          e.flags & 8192 && (f = null !== e.memoizedState, e.stateNode.isHidden = f, !f || null !== e.alternate && null !== e.alternate.memoizedState || (fk = B()));
          d & 4 && ak(a);
          break;
        case 22:
          m = null !== c && null !== c.memoizedState;
          a.mode & 1 ? (U = (l = U) || m, ck(b, a), U = l) : ck(b, a);
          ek(a);
          if (d & 8192) {
            l = null !== a.memoizedState;
            if ((a.stateNode.isHidden = l) && !m && 0 !== (a.mode & 1)) for (V = a, m = a.child; null !== m; ) {
              for (q = V = m; null !== V; ) {
                r = V;
                y = r.child;
                switch (r.tag) {
                  case 0:
                  case 11:
                  case 14:
                  case 15:
                    Pj(4, r, r.return);
                    break;
                  case 1:
                    Lj(r, r.return);
                    var n = r.stateNode;
                    if ("function" === typeof n.componentWillUnmount) {
                      d = r;
                      c = r.return;
                      try {
                        b = d, n.props = b.memoizedProps, n.state = b.memoizedState, n.componentWillUnmount();
                      } catch (t) {
                        W(d, c, t);
                      }
                    }
                    break;
                  case 5:
                    Lj(r, r.return);
                    break;
                  case 22:
                    if (null !== r.memoizedState) {
                      gk(q);
                      continue;
                    }
                }
                null !== y ? (y.return = r, V = y) : gk(q);
              }
              m = m.sibling;
            }
            a: for (m = null, q = a; ; ) {
              if (5 === q.tag) {
                if (null === m) {
                  m = q;
                  try {
                    e = q.stateNode, l ? (f = e.style, "function" === typeof f.setProperty ? f.setProperty("display", "none", "important") : f.display = "none") : (h = q.stateNode, k = q.memoizedProps.style, g = void 0 !== k && null !== k && k.hasOwnProperty("display") ? k.display : null, h.style.display = rb("display", g));
                  } catch (t) {
                    W(a, a.return, t);
                  }
                }
              } else if (6 === q.tag) {
                if (null === m) try {
                  q.stateNode.nodeValue = l ? "" : q.memoizedProps;
                } catch (t) {
                  W(a, a.return, t);
                }
              } else if ((22 !== q.tag && 23 !== q.tag || null === q.memoizedState || q === a) && null !== q.child) {
                q.child.return = q;
                q = q.child;
                continue;
              }
              if (q === a) break a;
              for (; null === q.sibling; ) {
                if (null === q.return || q.return === a) break a;
                m === q && (m = null);
                q = q.return;
              }
              m === q && (m = null);
              q.sibling.return = q.return;
              q = q.sibling;
            }
          }
          break;
        case 19:
          ck(b, a);
          ek(a);
          d & 4 && ak(a);
          break;
        case 21:
          break;
        default:
          ck(
            b,
            a
          ), ek(a);
      }
    }
    function ek(a) {
      var b = a.flags;
      if (b & 2) {
        try {
          a: {
            for (var c = a.return; null !== c; ) {
              if (Tj(c)) {
                var d = c;
                break a;
              }
              c = c.return;
            }
            throw Error(p(160));
          }
          switch (d.tag) {
            case 5:
              var e = d.stateNode;
              d.flags & 32 && (ob(e, ""), d.flags &= -33);
              var f = Uj(a);
              Wj(a, f, e);
              break;
            case 3:
            case 4:
              var g = d.stateNode.containerInfo, h = Uj(a);
              Vj(a, h, g);
              break;
            default:
              throw Error(p(161));
          }
        } catch (k) {
          W(a, a.return, k);
        }
        a.flags &= -3;
      }
      b & 4096 && (a.flags &= -4097);
    }
    function hk(a, b, c) {
      V = a;
      ik(a, b, c);
    }
    function ik(a, b, c) {
      for (var d = 0 !== (a.mode & 1); null !== V; ) {
        var e = V, f = e.child;
        if (22 === e.tag && d) {
          var g = null !== e.memoizedState || Jj;
          if (!g) {
            var h = e.alternate, k = null !== h && null !== h.memoizedState || U;
            h = Jj;
            var l = U;
            Jj = g;
            if ((U = k) && !l) for (V = e; null !== V; ) g = V, k = g.child, 22 === g.tag && null !== g.memoizedState ? jk(e) : null !== k ? (k.return = g, V = k) : jk(e);
            for (; null !== f; ) V = f, ik(f, b, c), f = f.sibling;
            V = e;
            Jj = h;
            U = l;
          }
          kk(a, b, c);
        } else 0 !== (e.subtreeFlags & 8772) && null !== f ? (f.return = e, V = f) : kk(a, b, c);
      }
    }
    function kk(a) {
      for (; null !== V; ) {
        var b = V;
        if (0 !== (b.flags & 8772)) {
          var c = b.alternate;
          try {
            if (0 !== (b.flags & 8772)) switch (b.tag) {
              case 0:
              case 11:
              case 15:
                U || Qj(5, b);
                break;
              case 1:
                var d = b.stateNode;
                if (b.flags & 4 && !U) if (null === c) d.componentDidMount();
                else {
                  var e = b.elementType === b.type ? c.memoizedProps : Ci(b.type, c.memoizedProps);
                  d.componentDidUpdate(e, c.memoizedState, d.__reactInternalSnapshotBeforeUpdate);
                }
                var f = b.updateQueue;
                null !== f && sh(b, f, d);
                break;
              case 3:
                var g = b.updateQueue;
                if (null !== g) {
                  c = null;
                  if (null !== b.child) switch (b.child.tag) {
                    case 5:
                      c = b.child.stateNode;
                      break;
                    case 1:
                      c = b.child.stateNode;
                  }
                  sh(b, g, c);
                }
                break;
              case 5:
                var h = b.stateNode;
                if (null === c && b.flags & 4) {
                  c = h;
                  var k = b.memoizedProps;
                  switch (b.type) {
                    case "button":
                    case "input":
                    case "select":
                    case "textarea":
                      k.autoFocus && c.focus();
                      break;
                    case "img":
                      k.src && (c.src = k.src);
                  }
                }
                break;
              case 6:
                break;
              case 4:
                break;
              case 12:
                break;
              case 13:
                if (null === b.memoizedState) {
                  var l = b.alternate;
                  if (null !== l) {
                    var m = l.memoizedState;
                    if (null !== m) {
                      var q = m.dehydrated;
                      null !== q && bd(q);
                    }
                  }
                }
                break;
              case 19:
              case 17:
              case 21:
              case 22:
              case 23:
              case 25:
                break;
              default:
                throw Error(p(163));
            }
            U || b.flags & 512 && Rj(b);
          } catch (r) {
            W(b, b.return, r);
          }
        }
        if (b === a) {
          V = null;
          break;
        }
        c = b.sibling;
        if (null !== c) {
          c.return = b.return;
          V = c;
          break;
        }
        V = b.return;
      }
    }
    function gk(a) {
      for (; null !== V; ) {
        var b = V;
        if (b === a) {
          V = null;
          break;
        }
        var c = b.sibling;
        if (null !== c) {
          c.return = b.return;
          V = c;
          break;
        }
        V = b.return;
      }
    }
    function jk(a) {
      for (; null !== V; ) {
        var b = V;
        try {
          switch (b.tag) {
            case 0:
            case 11:
            case 15:
              var c = b.return;
              try {
                Qj(4, b);
              } catch (k) {
                W(b, c, k);
              }
              break;
            case 1:
              var d = b.stateNode;
              if ("function" === typeof d.componentDidMount) {
                var e = b.return;
                try {
                  d.componentDidMount();
                } catch (k) {
                  W(b, e, k);
                }
              }
              var f = b.return;
              try {
                Rj(b);
              } catch (k) {
                W(b, f, k);
              }
              break;
            case 5:
              var g = b.return;
              try {
                Rj(b);
              } catch (k) {
                W(b, g, k);
              }
          }
        } catch (k) {
          W(b, b.return, k);
        }
        if (b === a) {
          V = null;
          break;
        }
        var h = b.sibling;
        if (null !== h) {
          h.return = b.return;
          V = h;
          break;
        }
        V = b.return;
      }
    }
    var lk = Math.ceil;
    var mk = ua.ReactCurrentDispatcher;
    var nk = ua.ReactCurrentOwner;
    var ok = ua.ReactCurrentBatchConfig;
    var K = 0;
    var Q = null;
    var Y = null;
    var Z = 0;
    var fj = 0;
    var ej = Uf(0);
    var T = 0;
    var pk = null;
    var rh = 0;
    var qk = 0;
    var rk = 0;
    var sk = null;
    var tk = null;
    var fk = 0;
    var Gj = Infinity;
    var uk = null;
    var Oi = false;
    var Pi = null;
    var Ri = null;
    var vk = false;
    var wk = null;
    var xk = 0;
    var yk = 0;
    var zk = null;
    var Ak = -1;
    var Bk = 0;
    function R() {
      return 0 !== (K & 6) ? B() : -1 !== Ak ? Ak : Ak = B();
    }
    function yi(a) {
      if (0 === (a.mode & 1)) return 1;
      if (0 !== (K & 2) && 0 !== Z) return Z & -Z;
      if (null !== Kg.transition) return 0 === Bk && (Bk = yc()), Bk;
      a = C2;
      if (0 !== a) return a;
      a = window.event;
      a = void 0 === a ? 16 : jd(a.type);
      return a;
    }
    function gi(a, b, c, d) {
      if (50 < yk) throw yk = 0, zk = null, Error(p(185));
      Ac(a, c, d);
      if (0 === (K & 2) || a !== Q) a === Q && (0 === (K & 2) && (qk |= c), 4 === T && Ck(a, Z)), Dk(a, d), 1 === c && 0 === K && 0 === (b.mode & 1) && (Gj = B() + 500, fg && jg());
    }
    function Dk(a, b) {
      var c = a.callbackNode;
      wc(a, b);
      var d = uc(a, a === Q ? Z : 0);
      if (0 === d) null !== c && bc(c), a.callbackNode = null, a.callbackPriority = 0;
      else if (b = d & -d, a.callbackPriority !== b) {
        null != c && bc(c);
        if (1 === b) 0 === a.tag ? ig(Ek.bind(null, a)) : hg(Ek.bind(null, a)), Jf(function() {
          0 === (K & 6) && jg();
        }), c = null;
        else {
          switch (Dc(d)) {
            case 1:
              c = fc;
              break;
            case 4:
              c = gc;
              break;
            case 16:
              c = hc;
              break;
            case 536870912:
              c = jc;
              break;
            default:
              c = hc;
          }
          c = Fk(c, Gk.bind(null, a));
        }
        a.callbackPriority = b;
        a.callbackNode = c;
      }
    }
    function Gk(a, b) {
      Ak = -1;
      Bk = 0;
      if (0 !== (K & 6)) throw Error(p(327));
      var c = a.callbackNode;
      if (Hk() && a.callbackNode !== c) return null;
      var d = uc(a, a === Q ? Z : 0);
      if (0 === d) return null;
      if (0 !== (d & 30) || 0 !== (d & a.expiredLanes) || b) b = Ik(a, d);
      else {
        b = d;
        var e = K;
        K |= 2;
        var f = Jk();
        if (Q !== a || Z !== b) uk = null, Gj = B() + 500, Kk(a, b);
        do
          try {
            Lk();
            break;
          } catch (h) {
            Mk(a, h);
          }
        while (1);
        $g();
        mk.current = f;
        K = e;
        null !== Y ? b = 0 : (Q = null, Z = 0, b = T);
      }
      if (0 !== b) {
        2 === b && (e = xc(a), 0 !== e && (d = e, b = Nk(a, e)));
        if (1 === b) throw c = pk, Kk(a, 0), Ck(a, d), Dk(a, B()), c;
        if (6 === b) Ck(a, d);
        else {
          e = a.current.alternate;
          if (0 === (d & 30) && !Ok(e) && (b = Ik(a, d), 2 === b && (f = xc(a), 0 !== f && (d = f, b = Nk(a, f))), 1 === b)) throw c = pk, Kk(a, 0), Ck(a, d), Dk(a, B()), c;
          a.finishedWork = e;
          a.finishedLanes = d;
          switch (b) {
            case 0:
            case 1:
              throw Error(p(345));
            case 2:
              Pk(a, tk, uk);
              break;
            case 3:
              Ck(a, d);
              if ((d & 130023424) === d && (b = fk + 500 - B(), 10 < b)) {
                if (0 !== uc(a, 0)) break;
                e = a.suspendedLanes;
                if ((e & d) !== d) {
                  R();
                  a.pingedLanes |= a.suspendedLanes & e;
                  break;
                }
                a.timeoutHandle = Ff(Pk.bind(null, a, tk, uk), b);
                break;
              }
              Pk(a, tk, uk);
              break;
            case 4:
              Ck(a, d);
              if ((d & 4194240) === d) break;
              b = a.eventTimes;
              for (e = -1; 0 < d; ) {
                var g = 31 - oc(d);
                f = 1 << g;
                g = b[g];
                g > e && (e = g);
                d &= ~f;
              }
              d = e;
              d = B() - d;
              d = (120 > d ? 120 : 480 > d ? 480 : 1080 > d ? 1080 : 1920 > d ? 1920 : 3e3 > d ? 3e3 : 4320 > d ? 4320 : 1960 * lk(d / 1960)) - d;
              if (10 < d) {
                a.timeoutHandle = Ff(Pk.bind(null, a, tk, uk), d);
                break;
              }
              Pk(a, tk, uk);
              break;
            case 5:
              Pk(a, tk, uk);
              break;
            default:
              throw Error(p(329));
          }
        }
      }
      Dk(a, B());
      return a.callbackNode === c ? Gk.bind(null, a) : null;
    }
    function Nk(a, b) {
      var c = sk;
      a.current.memoizedState.isDehydrated && (Kk(a, b).flags |= 256);
      a = Ik(a, b);
      2 !== a && (b = tk, tk = c, null !== b && Fj(b));
      return a;
    }
    function Fj(a) {
      null === tk ? tk = a : tk.push.apply(tk, a);
    }
    function Ok(a) {
      for (var b = a; ; ) {
        if (b.flags & 16384) {
          var c = b.updateQueue;
          if (null !== c && (c = c.stores, null !== c)) for (var d = 0; d < c.length; d++) {
            var e = c[d], f = e.getSnapshot;
            e = e.value;
            try {
              if (!He(f(), e)) return false;
            } catch (g) {
              return false;
            }
          }
        }
        c = b.child;
        if (b.subtreeFlags & 16384 && null !== c) c.return = b, b = c;
        else {
          if (b === a) break;
          for (; null === b.sibling; ) {
            if (null === b.return || b.return === a) return true;
            b = b.return;
          }
          b.sibling.return = b.return;
          b = b.sibling;
        }
      }
      return true;
    }
    function Ck(a, b) {
      b &= ~rk;
      b &= ~qk;
      a.suspendedLanes |= b;
      a.pingedLanes &= ~b;
      for (a = a.expirationTimes; 0 < b; ) {
        var c = 31 - oc(b), d = 1 << c;
        a[c] = -1;
        b &= ~d;
      }
    }
    function Ek(a) {
      if (0 !== (K & 6)) throw Error(p(327));
      Hk();
      var b = uc(a, 0);
      if (0 === (b & 1)) return Dk(a, B()), null;
      var c = Ik(a, b);
      if (0 !== a.tag && 2 === c) {
        var d = xc(a);
        0 !== d && (b = d, c = Nk(a, d));
      }
      if (1 === c) throw c = pk, Kk(a, 0), Ck(a, b), Dk(a, B()), c;
      if (6 === c) throw Error(p(345));
      a.finishedWork = a.current.alternate;
      a.finishedLanes = b;
      Pk(a, tk, uk);
      Dk(a, B());
      return null;
    }
    function Qk(a, b) {
      var c = K;
      K |= 1;
      try {
        return a(b);
      } finally {
        K = c, 0 === K && (Gj = B() + 500, fg && jg());
      }
    }
    function Rk(a) {
      null !== wk && 0 === wk.tag && 0 === (K & 6) && Hk();
      var b = K;
      K |= 1;
      var c = ok.transition, d = C2;
      try {
        if (ok.transition = null, C2 = 1, a) return a();
      } finally {
        C2 = d, ok.transition = c, K = b, 0 === (K & 6) && jg();
      }
    }
    function Hj() {
      fj = ej.current;
      E(ej);
    }
    function Kk(a, b) {
      a.finishedWork = null;
      a.finishedLanes = 0;
      var c = a.timeoutHandle;
      -1 !== c && (a.timeoutHandle = -1, Gf(c));
      if (null !== Y) for (c = Y.return; null !== c; ) {
        var d = c;
        wg(d);
        switch (d.tag) {
          case 1:
            d = d.type.childContextTypes;
            null !== d && void 0 !== d && $f();
            break;
          case 3:
            zh();
            E(Wf);
            E(H);
            Eh();
            break;
          case 5:
            Bh(d);
            break;
          case 4:
            zh();
            break;
          case 13:
            E(L);
            break;
          case 19:
            E(L);
            break;
          case 10:
            ah(d.type._context);
            break;
          case 22:
          case 23:
            Hj();
        }
        c = c.return;
      }
      Q = a;
      Y = a = Pg(a.current, null);
      Z = fj = b;
      T = 0;
      pk = null;
      rk = qk = rh = 0;
      tk = sk = null;
      if (null !== fh) {
        for (b = 0; b < fh.length; b++) if (c = fh[b], d = c.interleaved, null !== d) {
          c.interleaved = null;
          var e = d.next, f = c.pending;
          if (null !== f) {
            var g = f.next;
            f.next = e;
            d.next = g;
          }
          c.pending = d;
        }
        fh = null;
      }
      return a;
    }
    function Mk(a, b) {
      do {
        var c = Y;
        try {
          $g();
          Fh.current = Rh;
          if (Ih) {
            for (var d = M.memoizedState; null !== d; ) {
              var e = d.queue;
              null !== e && (e.pending = null);
              d = d.next;
            }
            Ih = false;
          }
          Hh = 0;
          O = N = M = null;
          Jh = false;
          Kh = 0;
          nk.current = null;
          if (null === c || null === c.return) {
            T = 1;
            pk = b;
            Y = null;
            break;
          }
          a: {
            var f = a, g = c.return, h = c, k = b;
            b = Z;
            h.flags |= 32768;
            if (null !== k && "object" === typeof k && "function" === typeof k.then) {
              var l = k, m = h, q = m.tag;
              if (0 === (m.mode & 1) && (0 === q || 11 === q || 15 === q)) {
                var r = m.alternate;
                r ? (m.updateQueue = r.updateQueue, m.memoizedState = r.memoizedState, m.lanes = r.lanes) : (m.updateQueue = null, m.memoizedState = null);
              }
              var y = Ui(g);
              if (null !== y) {
                y.flags &= -257;
                Vi(y, g, h, f, b);
                y.mode & 1 && Si(f, l, b);
                b = y;
                k = l;
                var n = b.updateQueue;
                if (null === n) {
                  var t = /* @__PURE__ */ new Set();
                  t.add(k);
                  b.updateQueue = t;
                } else n.add(k);
                break a;
              } else {
                if (0 === (b & 1)) {
                  Si(f, l, b);
                  tj();
                  break a;
                }
                k = Error(p(426));
              }
            } else if (I && h.mode & 1) {
              var J = Ui(g);
              if (null !== J) {
                0 === (J.flags & 65536) && (J.flags |= 256);
                Vi(J, g, h, f, b);
                Jg(Ji(k, h));
                break a;
              }
            }
            f = k = Ji(k, h);
            4 !== T && (T = 2);
            null === sk ? sk = [f] : sk.push(f);
            f = g;
            do {
              switch (f.tag) {
                case 3:
                  f.flags |= 65536;
                  b &= -b;
                  f.lanes |= b;
                  var x = Ni(f, k, b);
                  ph(f, x);
                  break a;
                case 1:
                  h = k;
                  var w = f.type, u = f.stateNode;
                  if (0 === (f.flags & 128) && ("function" === typeof w.getDerivedStateFromError || null !== u && "function" === typeof u.componentDidCatch && (null === Ri || !Ri.has(u)))) {
                    f.flags |= 65536;
                    b &= -b;
                    f.lanes |= b;
                    var F = Qi(f, h, b);
                    ph(f, F);
                    break a;
                  }
              }
              f = f.return;
            } while (null !== f);
          }
          Sk(c);
        } catch (na) {
          b = na;
          Y === c && null !== c && (Y = c = c.return);
          continue;
        }
        break;
      } while (1);
    }
    function Jk() {
      var a = mk.current;
      mk.current = Rh;
      return null === a ? Rh : a;
    }
    function tj() {
      if (0 === T || 3 === T || 2 === T) T = 4;
      null === Q || 0 === (rh & 268435455) && 0 === (qk & 268435455) || Ck(Q, Z);
    }
    function Ik(a, b) {
      var c = K;
      K |= 2;
      var d = Jk();
      if (Q !== a || Z !== b) uk = null, Kk(a, b);
      do
        try {
          Tk();
          break;
        } catch (e) {
          Mk(a, e);
        }
      while (1);
      $g();
      K = c;
      mk.current = d;
      if (null !== Y) throw Error(p(261));
      Q = null;
      Z = 0;
      return T;
    }
    function Tk() {
      for (; null !== Y; ) Uk(Y);
    }
    function Lk() {
      for (; null !== Y && !cc(); ) Uk(Y);
    }
    function Uk(a) {
      var b = Vk(a.alternate, a, fj);
      a.memoizedProps = a.pendingProps;
      null === b ? Sk(a) : Y = b;
      nk.current = null;
    }
    function Sk(a) {
      var b = a;
      do {
        var c = b.alternate;
        a = b.return;
        if (0 === (b.flags & 32768)) {
          if (c = Ej(c, b, fj), null !== c) {
            Y = c;
            return;
          }
        } else {
          c = Ij(c, b);
          if (null !== c) {
            c.flags &= 32767;
            Y = c;
            return;
          }
          if (null !== a) a.flags |= 32768, a.subtreeFlags = 0, a.deletions = null;
          else {
            T = 6;
            Y = null;
            return;
          }
        }
        b = b.sibling;
        if (null !== b) {
          Y = b;
          return;
        }
        Y = b = a;
      } while (null !== b);
      0 === T && (T = 5);
    }
    function Pk(a, b, c) {
      var d = C2, e = ok.transition;
      try {
        ok.transition = null, C2 = 1, Wk(a, b, c, d);
      } finally {
        ok.transition = e, C2 = d;
      }
      return null;
    }
    function Wk(a, b, c, d) {
      do
        Hk();
      while (null !== wk);
      if (0 !== (K & 6)) throw Error(p(327));
      c = a.finishedWork;
      var e = a.finishedLanes;
      if (null === c) return null;
      a.finishedWork = null;
      a.finishedLanes = 0;
      if (c === a.current) throw Error(p(177));
      a.callbackNode = null;
      a.callbackPriority = 0;
      var f = c.lanes | c.childLanes;
      Bc(a, f);
      a === Q && (Y = Q = null, Z = 0);
      0 === (c.subtreeFlags & 2064) && 0 === (c.flags & 2064) || vk || (vk = true, Fk(hc, function() {
        Hk();
        return null;
      }));
      f = 0 !== (c.flags & 15990);
      if (0 !== (c.subtreeFlags & 15990) || f) {
        f = ok.transition;
        ok.transition = null;
        var g = C2;
        C2 = 1;
        var h = K;
        K |= 4;
        nk.current = null;
        Oj(a, c);
        dk(c, a);
        Oe(Df);
        dd = !!Cf;
        Df = Cf = null;
        a.current = c;
        hk(c, a, e);
        dc();
        K = h;
        C2 = g;
        ok.transition = f;
      } else a.current = c;
      vk && (vk = false, wk = a, xk = e);
      f = a.pendingLanes;
      0 === f && (Ri = null);
      mc(c.stateNode, d);
      Dk(a, B());
      if (null !== b) for (d = a.onRecoverableError, c = 0; c < b.length; c++) e = b[c], d(e.value, { componentStack: e.stack, digest: e.digest });
      if (Oi) throw Oi = false, a = Pi, Pi = null, a;
      0 !== (xk & 1) && 0 !== a.tag && Hk();
      f = a.pendingLanes;
      0 !== (f & 1) ? a === zk ? yk++ : (yk = 0, zk = a) : yk = 0;
      jg();
      return null;
    }
    function Hk() {
      if (null !== wk) {
        var a = Dc(xk), b = ok.transition, c = C2;
        try {
          ok.transition = null;
          C2 = 16 > a ? 16 : a;
          if (null === wk) var d = false;
          else {
            a = wk;
            wk = null;
            xk = 0;
            if (0 !== (K & 6)) throw Error(p(331));
            var e = K;
            K |= 4;
            for (V = a.current; null !== V; ) {
              var f = V, g = f.child;
              if (0 !== (V.flags & 16)) {
                var h = f.deletions;
                if (null !== h) {
                  for (var k = 0; k < h.length; k++) {
                    var l = h[k];
                    for (V = l; null !== V; ) {
                      var m = V;
                      switch (m.tag) {
                        case 0:
                        case 11:
                        case 15:
                          Pj(8, m, f);
                      }
                      var q = m.child;
                      if (null !== q) q.return = m, V = q;
                      else for (; null !== V; ) {
                        m = V;
                        var r = m.sibling, y = m.return;
                        Sj(m);
                        if (m === l) {
                          V = null;
                          break;
                        }
                        if (null !== r) {
                          r.return = y;
                          V = r;
                          break;
                        }
                        V = y;
                      }
                    }
                  }
                  var n = f.alternate;
                  if (null !== n) {
                    var t = n.child;
                    if (null !== t) {
                      n.child = null;
                      do {
                        var J = t.sibling;
                        t.sibling = null;
                        t = J;
                      } while (null !== t);
                    }
                  }
                  V = f;
                }
              }
              if (0 !== (f.subtreeFlags & 2064) && null !== g) g.return = f, V = g;
              else b: for (; null !== V; ) {
                f = V;
                if (0 !== (f.flags & 2048)) switch (f.tag) {
                  case 0:
                  case 11:
                  case 15:
                    Pj(9, f, f.return);
                }
                var x = f.sibling;
                if (null !== x) {
                  x.return = f.return;
                  V = x;
                  break b;
                }
                V = f.return;
              }
            }
            var w = a.current;
            for (V = w; null !== V; ) {
              g = V;
              var u = g.child;
              if (0 !== (g.subtreeFlags & 2064) && null !== u) u.return = g, V = u;
              else b: for (g = w; null !== V; ) {
                h = V;
                if (0 !== (h.flags & 2048)) try {
                  switch (h.tag) {
                    case 0:
                    case 11:
                    case 15:
                      Qj(9, h);
                  }
                } catch (na) {
                  W(h, h.return, na);
                }
                if (h === g) {
                  V = null;
                  break b;
                }
                var F = h.sibling;
                if (null !== F) {
                  F.return = h.return;
                  V = F;
                  break b;
                }
                V = h.return;
              }
            }
            K = e;
            jg();
            if (lc && "function" === typeof lc.onPostCommitFiberRoot) try {
              lc.onPostCommitFiberRoot(kc, a);
            } catch (na) {
            }
            d = true;
          }
          return d;
        } finally {
          C2 = c, ok.transition = b;
        }
      }
      return false;
    }
    function Xk(a, b, c) {
      b = Ji(c, b);
      b = Ni(a, b, 1);
      a = nh(a, b, 1);
      b = R();
      null !== a && (Ac(a, 1, b), Dk(a, b));
    }
    function W(a, b, c) {
      if (3 === a.tag) Xk(a, a, c);
      else for (; null !== b; ) {
        if (3 === b.tag) {
          Xk(b, a, c);
          break;
        } else if (1 === b.tag) {
          var d = b.stateNode;
          if ("function" === typeof b.type.getDerivedStateFromError || "function" === typeof d.componentDidCatch && (null === Ri || !Ri.has(d))) {
            a = Ji(c, a);
            a = Qi(b, a, 1);
            b = nh(b, a, 1);
            a = R();
            null !== b && (Ac(b, 1, a), Dk(b, a));
            break;
          }
        }
        b = b.return;
      }
    }
    function Ti(a, b, c) {
      var d = a.pingCache;
      null !== d && d.delete(b);
      b = R();
      a.pingedLanes |= a.suspendedLanes & c;
      Q === a && (Z & c) === c && (4 === T || 3 === T && (Z & 130023424) === Z && 500 > B() - fk ? Kk(a, 0) : rk |= c);
      Dk(a, b);
    }
    function Yk(a, b) {
      0 === b && (0 === (a.mode & 1) ? b = 1 : (b = sc, sc <<= 1, 0 === (sc & 130023424) && (sc = 4194304)));
      var c = R();
      a = ih(a, b);
      null !== a && (Ac(a, b, c), Dk(a, c));
    }
    function uj(a) {
      var b = a.memoizedState, c = 0;
      null !== b && (c = b.retryLane);
      Yk(a, c);
    }
    function bk(a, b) {
      var c = 0;
      switch (a.tag) {
        case 13:
          var d = a.stateNode;
          var e = a.memoizedState;
          null !== e && (c = e.retryLane);
          break;
        case 19:
          d = a.stateNode;
          break;
        default:
          throw Error(p(314));
      }
      null !== d && d.delete(b);
      Yk(a, c);
    }
    var Vk;
    Vk = function(a, b, c) {
      if (null !== a) if (a.memoizedProps !== b.pendingProps || Wf.current) dh = true;
      else {
        if (0 === (a.lanes & c) && 0 === (b.flags & 128)) return dh = false, yj(a, b, c);
        dh = 0 !== (a.flags & 131072) ? true : false;
      }
      else dh = false, I && 0 !== (b.flags & 1048576) && ug(b, ng, b.index);
      b.lanes = 0;
      switch (b.tag) {
        case 2:
          var d = b.type;
          ij(a, b);
          a = b.pendingProps;
          var e = Yf(b, H.current);
          ch(b, c);
          e = Nh(null, b, d, a, e, c);
          var f = Sh();
          b.flags |= 1;
          "object" === typeof e && null !== e && "function" === typeof e.render && void 0 === e.$$typeof ? (b.tag = 1, b.memoizedState = null, b.updateQueue = null, Zf(d) ? (f = true, cg(b)) : f = false, b.memoizedState = null !== e.state && void 0 !== e.state ? e.state : null, kh(b), e.updater = Ei, b.stateNode = e, e._reactInternals = b, Ii(b, d, a, c), b = jj(null, b, d, true, f, c)) : (b.tag = 0, I && f && vg(b), Xi(null, b, e, c), b = b.child);
          return b;
        case 16:
          d = b.elementType;
          a: {
            ij(a, b);
            a = b.pendingProps;
            e = d._init;
            d = e(d._payload);
            b.type = d;
            e = b.tag = Zk(d);
            a = Ci(d, a);
            switch (e) {
              case 0:
                b = cj(null, b, d, a, c);
                break a;
              case 1:
                b = hj(null, b, d, a, c);
                break a;
              case 11:
                b = Yi(null, b, d, a, c);
                break a;
              case 14:
                b = $i(null, b, d, Ci(d.type, a), c);
                break a;
            }
            throw Error(p(
              306,
              d,
              ""
            ));
          }
          return b;
        case 0:
          return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), cj(a, b, d, e, c);
        case 1:
          return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), hj(a, b, d, e, c);
        case 3:
          a: {
            kj(b);
            if (null === a) throw Error(p(387));
            d = b.pendingProps;
            f = b.memoizedState;
            e = f.element;
            lh(a, b);
            qh(b, d, null, c);
            var g = b.memoizedState;
            d = g.element;
            if (f.isDehydrated) if (f = { element: d, isDehydrated: false, cache: g.cache, pendingSuspenseBoundaries: g.pendingSuspenseBoundaries, transitions: g.transitions }, b.updateQueue.baseState = f, b.memoizedState = f, b.flags & 256) {
              e = Ji(Error(p(423)), b);
              b = lj(a, b, d, c, e);
              break a;
            } else if (d !== e) {
              e = Ji(Error(p(424)), b);
              b = lj(a, b, d, c, e);
              break a;
            } else for (yg = Lf(b.stateNode.containerInfo.firstChild), xg = b, I = true, zg = null, c = Vg(b, null, d, c), b.child = c; c; ) c.flags = c.flags & -3 | 4096, c = c.sibling;
            else {
              Ig();
              if (d === e) {
                b = Zi(a, b, c);
                break a;
              }
              Xi(a, b, d, c);
            }
            b = b.child;
          }
          return b;
        case 5:
          return Ah(b), null === a && Eg(b), d = b.type, e = b.pendingProps, f = null !== a ? a.memoizedProps : null, g = e.children, Ef(d, e) ? g = null : null !== f && Ef(d, f) && (b.flags |= 32), gj(a, b), Xi(a, b, g, c), b.child;
        case 6:
          return null === a && Eg(b), null;
        case 13:
          return oj(a, b, c);
        case 4:
          return yh(b, b.stateNode.containerInfo), d = b.pendingProps, null === a ? b.child = Ug(b, null, d, c) : Xi(a, b, d, c), b.child;
        case 11:
          return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), Yi(a, b, d, e, c);
        case 7:
          return Xi(a, b, b.pendingProps, c), b.child;
        case 8:
          return Xi(a, b, b.pendingProps.children, c), b.child;
        case 12:
          return Xi(a, b, b.pendingProps.children, c), b.child;
        case 10:
          a: {
            d = b.type._context;
            e = b.pendingProps;
            f = b.memoizedProps;
            g = e.value;
            G(Wg, d._currentValue);
            d._currentValue = g;
            if (null !== f) if (He(f.value, g)) {
              if (f.children === e.children && !Wf.current) {
                b = Zi(a, b, c);
                break a;
              }
            } else for (f = b.child, null !== f && (f.return = b); null !== f; ) {
              var h = f.dependencies;
              if (null !== h) {
                g = f.child;
                for (var k = h.firstContext; null !== k; ) {
                  if (k.context === d) {
                    if (1 === f.tag) {
                      k = mh(-1, c & -c);
                      k.tag = 2;
                      var l = f.updateQueue;
                      if (null !== l) {
                        l = l.shared;
                        var m = l.pending;
                        null === m ? k.next = k : (k.next = m.next, m.next = k);
                        l.pending = k;
                      }
                    }
                    f.lanes |= c;
                    k = f.alternate;
                    null !== k && (k.lanes |= c);
                    bh(
                      f.return,
                      c,
                      b
                    );
                    h.lanes |= c;
                    break;
                  }
                  k = k.next;
                }
              } else if (10 === f.tag) g = f.type === b.type ? null : f.child;
              else if (18 === f.tag) {
                g = f.return;
                if (null === g) throw Error(p(341));
                g.lanes |= c;
                h = g.alternate;
                null !== h && (h.lanes |= c);
                bh(g, c, b);
                g = f.sibling;
              } else g = f.child;
              if (null !== g) g.return = f;
              else for (g = f; null !== g; ) {
                if (g === b) {
                  g = null;
                  break;
                }
                f = g.sibling;
                if (null !== f) {
                  f.return = g.return;
                  g = f;
                  break;
                }
                g = g.return;
              }
              f = g;
            }
            Xi(a, b, e.children, c);
            b = b.child;
          }
          return b;
        case 9:
          return e = b.type, d = b.pendingProps.children, ch(b, c), e = eh(e), d = d(e), b.flags |= 1, Xi(a, b, d, c), b.child;
        case 14:
          return d = b.type, e = Ci(d, b.pendingProps), e = Ci(d.type, e), $i(a, b, d, e, c);
        case 15:
          return bj(a, b, b.type, b.pendingProps, c);
        case 17:
          return d = b.type, e = b.pendingProps, e = b.elementType === d ? e : Ci(d, e), ij(a, b), b.tag = 1, Zf(d) ? (a = true, cg(b)) : a = false, ch(b, c), Gi(b, d, e), Ii(b, d, e, c), jj(null, b, d, true, a, c);
        case 19:
          return xj(a, b, c);
        case 22:
          return dj(a, b, c);
      }
      throw Error(p(156, b.tag));
    };
    function Fk(a, b) {
      return ac(a, b);
    }
    function $k(a, b, c, d) {
      this.tag = a;
      this.key = c;
      this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null;
      this.index = 0;
      this.ref = null;
      this.pendingProps = b;
      this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null;
      this.mode = d;
      this.subtreeFlags = this.flags = 0;
      this.deletions = null;
      this.childLanes = this.lanes = 0;
      this.alternate = null;
    }
    function Bg(a, b, c, d) {
      return new $k(a, b, c, d);
    }
    function aj(a) {
      a = a.prototype;
      return !(!a || !a.isReactComponent);
    }
    function Zk(a) {
      if ("function" === typeof a) return aj(a) ? 1 : 0;
      if (void 0 !== a && null !== a) {
        a = a.$$typeof;
        if (a === Da) return 11;
        if (a === Ga) return 14;
      }
      return 2;
    }
    function Pg(a, b) {
      var c = a.alternate;
      null === c ? (c = Bg(a.tag, b, a.key, a.mode), c.elementType = a.elementType, c.type = a.type, c.stateNode = a.stateNode, c.alternate = a, a.alternate = c) : (c.pendingProps = b, c.type = a.type, c.flags = 0, c.subtreeFlags = 0, c.deletions = null);
      c.flags = a.flags & 14680064;
      c.childLanes = a.childLanes;
      c.lanes = a.lanes;
      c.child = a.child;
      c.memoizedProps = a.memoizedProps;
      c.memoizedState = a.memoizedState;
      c.updateQueue = a.updateQueue;
      b = a.dependencies;
      c.dependencies = null === b ? null : { lanes: b.lanes, firstContext: b.firstContext };
      c.sibling = a.sibling;
      c.index = a.index;
      c.ref = a.ref;
      return c;
    }
    function Rg(a, b, c, d, e, f) {
      var g = 2;
      d = a;
      if ("function" === typeof a) aj(a) && (g = 1);
      else if ("string" === typeof a) g = 5;
      else a: switch (a) {
        case ya:
          return Tg(c.children, e, f, b);
        case za:
          g = 8;
          e |= 8;
          break;
        case Aa:
          return a = Bg(12, c, b, e | 2), a.elementType = Aa, a.lanes = f, a;
        case Ea:
          return a = Bg(13, c, b, e), a.elementType = Ea, a.lanes = f, a;
        case Fa:
          return a = Bg(19, c, b, e), a.elementType = Fa, a.lanes = f, a;
        case Ia:
          return pj(c, e, f, b);
        default:
          if ("object" === typeof a && null !== a) switch (a.$$typeof) {
            case Ba:
              g = 10;
              break a;
            case Ca:
              g = 9;
              break a;
            case Da:
              g = 11;
              break a;
            case Ga:
              g = 14;
              break a;
            case Ha:
              g = 16;
              d = null;
              break a;
          }
          throw Error(p(130, null == a ? a : typeof a, ""));
      }
      b = Bg(g, c, b, e);
      b.elementType = a;
      b.type = d;
      b.lanes = f;
      return b;
    }
    function Tg(a, b, c, d) {
      a = Bg(7, a, d, b);
      a.lanes = c;
      return a;
    }
    function pj(a, b, c, d) {
      a = Bg(22, a, d, b);
      a.elementType = Ia;
      a.lanes = c;
      a.stateNode = { isHidden: false };
      return a;
    }
    function Qg(a, b, c) {
      a = Bg(6, a, null, b);
      a.lanes = c;
      return a;
    }
    function Sg(a, b, c) {
      b = Bg(4, null !== a.children ? a.children : [], a.key, b);
      b.lanes = c;
      b.stateNode = { containerInfo: a.containerInfo, pendingChildren: null, implementation: a.implementation };
      return b;
    }
    function al(a, b, c, d, e) {
      this.tag = b;
      this.containerInfo = a;
      this.finishedWork = this.pingCache = this.current = this.pendingChildren = null;
      this.timeoutHandle = -1;
      this.callbackNode = this.pendingContext = this.context = null;
      this.callbackPriority = 0;
      this.eventTimes = zc(0);
      this.expirationTimes = zc(-1);
      this.entangledLanes = this.finishedLanes = this.mutableReadLanes = this.expiredLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0;
      this.entanglements = zc(0);
      this.identifierPrefix = d;
      this.onRecoverableError = e;
      this.mutableSourceEagerHydrationData = null;
    }
    function bl(a, b, c, d, e, f, g, h, k) {
      a = new al(a, b, c, h, k);
      1 === b ? (b = 1, true === f && (b |= 8)) : b = 0;
      f = Bg(3, null, null, b);
      a.current = f;
      f.stateNode = a;
      f.memoizedState = { element: d, isDehydrated: c, cache: null, transitions: null, pendingSuspenseBoundaries: null };
      kh(f);
      return a;
    }
    function cl(a, b, c) {
      var d = 3 < arguments.length && void 0 !== arguments[3] ? arguments[3] : null;
      return { $$typeof: wa, key: null == d ? null : "" + d, children: a, containerInfo: b, implementation: c };
    }
    function dl(a) {
      if (!a) return Vf;
      a = a._reactInternals;
      a: {
        if (Vb(a) !== a || 1 !== a.tag) throw Error(p(170));
        var b = a;
        do {
          switch (b.tag) {
            case 3:
              b = b.stateNode.context;
              break a;
            case 1:
              if (Zf(b.type)) {
                b = b.stateNode.__reactInternalMemoizedMergedChildContext;
                break a;
              }
          }
          b = b.return;
        } while (null !== b);
        throw Error(p(171));
      }
      if (1 === a.tag) {
        var c = a.type;
        if (Zf(c)) return bg(a, c, b);
      }
      return b;
    }
    function el(a, b, c, d, e, f, g, h, k) {
      a = bl(c, d, true, a, e, f, g, h, k);
      a.context = dl(null);
      c = a.current;
      d = R();
      e = yi(c);
      f = mh(d, e);
      f.callback = void 0 !== b && null !== b ? b : null;
      nh(c, f, e);
      a.current.lanes = e;
      Ac(a, e, d);
      Dk(a, d);
      return a;
    }
    function fl(a, b, c, d) {
      var e = b.current, f = R(), g = yi(e);
      c = dl(c);
      null === b.context ? b.context = c : b.pendingContext = c;
      b = mh(f, g);
      b.payload = { element: a };
      d = void 0 === d ? null : d;
      null !== d && (b.callback = d);
      a = nh(e, b, g);
      null !== a && (gi(a, e, g, f), oh(a, e, g));
      return g;
    }
    function gl(a) {
      a = a.current;
      if (!a.child) return null;
      switch (a.child.tag) {
        case 5:
          return a.child.stateNode;
        default:
          return a.child.stateNode;
      }
    }
    function hl(a, b) {
      a = a.memoizedState;
      if (null !== a && null !== a.dehydrated) {
        var c = a.retryLane;
        a.retryLane = 0 !== c && c < b ? c : b;
      }
    }
    function il(a, b) {
      hl(a, b);
      (a = a.alternate) && hl(a, b);
    }
    function jl() {
      return null;
    }
    var kl = "function" === typeof reportError ? reportError : function(a) {
      console.error(a);
    };
    function ll(a) {
      this._internalRoot = a;
    }
    ml.prototype.render = ll.prototype.render = function(a) {
      var b = this._internalRoot;
      if (null === b) throw Error(p(409));
      fl(a, b, null, null);
    };
    ml.prototype.unmount = ll.prototype.unmount = function() {
      var a = this._internalRoot;
      if (null !== a) {
        this._internalRoot = null;
        var b = a.containerInfo;
        Rk(function() {
          fl(null, a, null, null);
        });
        b[uf] = null;
      }
    };
    function ml(a) {
      this._internalRoot = a;
    }
    ml.prototype.unstable_scheduleHydration = function(a) {
      if (a) {
        var b = Hc();
        a = { blockedOn: null, target: a, priority: b };
        for (var c = 0; c < Qc.length && 0 !== b && b < Qc[c].priority; c++) ;
        Qc.splice(c, 0, a);
        0 === c && Vc(a);
      }
    };
    function nl(a) {
      return !(!a || 1 !== a.nodeType && 9 !== a.nodeType && 11 !== a.nodeType);
    }
    function ol(a) {
      return !(!a || 1 !== a.nodeType && 9 !== a.nodeType && 11 !== a.nodeType && (8 !== a.nodeType || " react-mount-point-unstable " !== a.nodeValue));
    }
    function pl() {
    }
    function ql(a, b, c, d, e) {
      if (e) {
        if ("function" === typeof d) {
          var f = d;
          d = function() {
            var a2 = gl(g);
            f.call(a2);
          };
        }
        var g = el(b, d, a, 0, null, false, false, "", pl);
        a._reactRootContainer = g;
        a[uf] = g.current;
        sf(8 === a.nodeType ? a.parentNode : a);
        Rk();
        return g;
      }
      for (; e = a.lastChild; ) a.removeChild(e);
      if ("function" === typeof d) {
        var h = d;
        d = function() {
          var a2 = gl(k);
          h.call(a2);
        };
      }
      var k = bl(a, 0, false, null, null, false, false, "", pl);
      a._reactRootContainer = k;
      a[uf] = k.current;
      sf(8 === a.nodeType ? a.parentNode : a);
      Rk(function() {
        fl(b, k, c, d);
      });
      return k;
    }
    function rl(a, b, c, d, e) {
      var f = c._reactRootContainer;
      if (f) {
        var g = f;
        if ("function" === typeof e) {
          var h = e;
          e = function() {
            var a2 = gl(g);
            h.call(a2);
          };
        }
        fl(b, g, a, e);
      } else g = ql(c, b, a, e, d);
      return gl(g);
    }
    Ec = function(a) {
      switch (a.tag) {
        case 3:
          var b = a.stateNode;
          if (b.current.memoizedState.isDehydrated) {
            var c = tc(b.pendingLanes);
            0 !== c && (Cc(b, c | 1), Dk(b, B()), 0 === (K & 6) && (Gj = B() + 500, jg()));
          }
          break;
        case 13:
          Rk(function() {
            var b2 = ih(a, 1);
            if (null !== b2) {
              var c2 = R();
              gi(b2, a, 1, c2);
            }
          }), il(a, 1);
      }
    };
    Fc = function(a) {
      if (13 === a.tag) {
        var b = ih(a, 134217728);
        if (null !== b) {
          var c = R();
          gi(b, a, 134217728, c);
        }
        il(a, 134217728);
      }
    };
    Gc = function(a) {
      if (13 === a.tag) {
        var b = yi(a), c = ih(a, b);
        if (null !== c) {
          var d = R();
          gi(c, a, b, d);
        }
        il(a, b);
      }
    };
    Hc = function() {
      return C2;
    };
    Ic = function(a, b) {
      var c = C2;
      try {
        return C2 = a, b();
      } finally {
        C2 = c;
      }
    };
    yb = function(a, b, c) {
      switch (b) {
        case "input":
          bb(a, c);
          b = c.name;
          if ("radio" === c.type && null != b) {
            for (c = a; c.parentNode; ) c = c.parentNode;
            c = c.querySelectorAll("input[name=" + JSON.stringify("" + b) + '][type="radio"]');
            for (b = 0; b < c.length; b++) {
              var d = c[b];
              if (d !== a && d.form === a.form) {
                var e = Db(d);
                if (!e) throw Error(p(90));
                Wa(d);
                bb(d, e);
              }
            }
          }
          break;
        case "textarea":
          ib(a, c);
          break;
        case "select":
          b = c.value, null != b && fb(a, !!c.multiple, b, false);
      }
    };
    Gb = Qk;
    Hb = Rk;
    var sl = { usingClientEntryPoint: false, Events: [Cb, ue, Db, Eb, Fb, Qk] };
    var tl = { findFiberByHostInstance: Wc, bundleType: 0, version: "18.3.1", rendererPackageName: "react-dom" };
    var ul = { bundleType: tl.bundleType, version: tl.version, rendererPackageName: tl.rendererPackageName, rendererConfig: tl.rendererConfig, overrideHookState: null, overrideHookStateDeletePath: null, overrideHookStateRenamePath: null, overrideProps: null, overridePropsDeletePath: null, overridePropsRenamePath: null, setErrorHandler: null, setSuspenseHandler: null, scheduleUpdate: null, currentDispatcherRef: ua.ReactCurrentDispatcher, findHostInstanceByFiber: function(a) {
      a = Zb(a);
      return null === a ? null : a.stateNode;
    }, findFiberByHostInstance: tl.findFiberByHostInstance || jl, findHostInstancesForRefresh: null, scheduleRefresh: null, scheduleRoot: null, setRefreshHandler: null, getCurrentFiber: null, reconcilerVersion: "18.3.1-next-f1338f8080-20240426" };
    if ("undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__) {
      vl = __REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (!vl.isDisabled && vl.supportsFiber) try {
        kc = vl.inject(ul), lc = vl;
      } catch (a) {
      }
    }
    var vl;
    exports.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = sl;
    exports.createPortal = function(a, b) {
      var c = 2 < arguments.length && void 0 !== arguments[2] ? arguments[2] : null;
      if (!nl(b)) throw Error(p(200));
      return cl(a, b, null, c);
    };
    exports.createRoot = function(a, b) {
      if (!nl(a)) throw Error(p(299));
      var c = false, d = "", e = kl;
      null !== b && void 0 !== b && (true === b.unstable_strictMode && (c = true), void 0 !== b.identifierPrefix && (d = b.identifierPrefix), void 0 !== b.onRecoverableError && (e = b.onRecoverableError));
      b = bl(a, 1, false, null, null, c, false, d, e);
      a[uf] = b.current;
      sf(8 === a.nodeType ? a.parentNode : a);
      return new ll(b);
    };
    exports.findDOMNode = function(a) {
      if (null == a) return null;
      if (1 === a.nodeType) return a;
      var b = a._reactInternals;
      if (void 0 === b) {
        if ("function" === typeof a.render) throw Error(p(188));
        a = Object.keys(a).join(",");
        throw Error(p(268, a));
      }
      a = Zb(b);
      a = null === a ? null : a.stateNode;
      return a;
    };
    exports.flushSync = function(a) {
      return Rk(a);
    };
    exports.hydrate = function(a, b, c) {
      if (!ol(b)) throw Error(p(200));
      return rl(null, a, b, true, c);
    };
    exports.hydrateRoot = function(a, b, c) {
      if (!nl(a)) throw Error(p(405));
      var d = null != c && c.hydratedSources || null, e = false, f = "", g = kl;
      null !== c && void 0 !== c && (true === c.unstable_strictMode && (e = true), void 0 !== c.identifierPrefix && (f = c.identifierPrefix), void 0 !== c.onRecoverableError && (g = c.onRecoverableError));
      b = el(b, null, a, 1, null != c ? c : null, e, false, f, g);
      a[uf] = b.current;
      sf(a);
      if (d) for (a = 0; a < d.length; a++) c = d[a], e = c._getVersion, e = e(c._source), null == b.mutableSourceEagerHydrationData ? b.mutableSourceEagerHydrationData = [c, e] : b.mutableSourceEagerHydrationData.push(
        c,
        e
      );
      return new ml(b);
    };
    exports.render = function(a, b, c) {
      if (!ol(b)) throw Error(p(200));
      return rl(null, a, b, false, c);
    };
    exports.unmountComponentAtNode = function(a) {
      if (!ol(a)) throw Error(p(40));
      return a._reactRootContainer ? (Rk(function() {
        rl(null, null, a, false, function() {
          a._reactRootContainer = null;
          a[uf] = null;
        });
      }), true) : false;
    };
    exports.unstable_batchedUpdates = Qk;
    exports.unstable_renderSubtreeIntoContainer = function(a, b, c, d) {
      if (!ol(c)) throw Error(p(200));
      if (null == a || void 0 === a._reactInternals) throw Error(p(38));
      return rl(a, b, c, false, d);
    };
    exports.version = "18.3.1-next-f1338f8080-20240426";
  }
});

// node_modules/react-dom/index.js
var require_react_dom = __commonJS({
  "node_modules/react-dom/index.js"(exports, module) {
    "use strict";
    function checkDCE() {
      if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ === "undefined" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE !== "function") {
        return;
      }
      if (false) {
        throw new Error("^_^");
      }
      try {
        __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(checkDCE);
      } catch (err) {
        console.error(err);
      }
    }
    if (true) {
      checkDCE();
      module.exports = require_react_dom_production_min();
    } else {
      module.exports = null;
    }
  }
});

// node_modules/react-dom/client.js
var require_client = __commonJS({
  "node_modules/react-dom/client.js"(exports) {
    "use strict";
    var m = require_react_dom();
    if (true) {
      exports.createRoot = m.createRoot;
      exports.hydrateRoot = m.hydrateRoot;
    } else {
      i = m.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
      exports.createRoot = function(c, o) {
        i.usingClientEntryPoint = true;
        try {
          return m.createRoot(c, o);
        } finally {
          i.usingClientEntryPoint = false;
        }
      };
      exports.hydrateRoot = function(c, h, o) {
        i.usingClientEntryPoint = true;
        try {
          return m.hydrateRoot(c, h, o);
        } finally {
          i.usingClientEntryPoint = false;
        }
      };
    }
    var i;
  }
});

// web/main.js
var import_react = __toESM(require_react(), 1);
var import_client = __toESM(require_client(), 1);

// src/app.js
function createTetherPanel({ React: React2, Native, host }) {
  const h = React2.createElement;
  const PANEL_ID = "tether";
  const BASE = host.apiBase();
  const C2 = {
    ink: "var(--dsw-alias-label-primary, #101828)",
    sub: "var(--dsw-alias-label-secondary, #475467)",
    mute: "var(--dsw-alias-label-tertiary, #667085)",
    line: "var(--dsw-alias-border-l1, rgba(9, 30, 66, 0.04))",
    soft: "var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))",
    hover: "var(--dsw-alias-interactive-bg-hover-solid, #f2f4f7)",
    active: "var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, 0.10))",
    bg: "var(--dsw-alias-bg-base, #ffffff)",
    panel: "var(--dsw-specific-sidebar-fill, #f9fafb)",
    layer1: "var(--dsw-alias-bg-layer-1, #ffffff)",
    layer2: "var(--dsw-alias-bg-layer-2, #ffffff)",
    layer3: "var(--dsw-alias-bg-layer-3, #ffffff)",
    input: "var(--dsw-specific-input-major, #ffffff)",
    green: "var(--dsw-alias-state-success-primary, #16a34a)",
    red: "var(--dsw-alias-state-error-primary, #b42318)",
    blue: "var(--dsw-alias-state-business-primary, #1570ef)",
    amber: "var(--dsw-alias-state-warn-primary, #b54708)",
    primary: "var(--dsw-alias-button-primary-fill, #101828)",
    onPrimary: "var(--dsw-alias-label-primary-inverted, #ffffff)",
    bubble: "var(--dsw-specific-bubble, #f2f4f7)",
    nodeChild: "color-mix(in srgb, var(--dsw-alias-state-business-primary, #1570ef) 8%, var(--dsw-specific-sidebar-fill, #f9fafb))",
    nodeChildActive: "color-mix(in srgb, var(--dsw-alias-state-business-primary, #1570ef) 13%, var(--dsw-specific-sidebar-fill, #f9fafb))",
    block: "var(--dsw-alias-markdown-code-block, #f8fafc)",
    shadow: "var(--dsw-elevation-panel, 0 8px 24px rgba(16, 24, 40, 0.12))"
  };
  const apiBaseList = host && host.apiBases ? host.apiBases() : [BASE];
  let ACTIVE_BASE = apiBaseList[0] || BASE;
  async function api(path, options) {
    const init = { ...options || {} };
    init.headers = { "Content-Type": "application/json", ...init.headers || {} };
    const ordered = [ACTIVE_BASE, ...apiBaseList.filter((base) => base !== ACTIVE_BASE)];
    let lastError = null;
    for (const base of ordered) {
      let res;
      try {
        res = await fetch(base + path, init);
      } catch (error) {
        lastError = error;
        continue;
      }
      ACTIVE_BASE = base;
      let data = {};
      try {
        data = await res.json();
      } catch (_) {
      }
      if (!res.ok) {
        const detail = data && data.detail;
        const message = detail && detail.error || typeof detail === "string" && detail || data.error || "HTTP " + res.status;
        const err = new Error(message);
        err.code = detail && detail.code;
        throw err;
      }
      return data;
    }
    throw lastError || new Error("network error");
  }
  const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body || {}) });
  function pill(text, color) {
    return h("span", {
      style: {
        fontSize: 11,
        lineHeight: "18px",
        padding: "0 7px",
        borderRadius: 999,
        color: color || C2.sub,
        border: 0,
        background: C2.soft,
        whiteSpace: "nowrap"
      }
    }, text);
  }
  function dot(on, color) {
    return h("span", { style: { width: 7, height: 7, borderRadius: 4, display: "inline-block", background: color || (on ? C2.green : C2.mute), marginRight: 7, flex: "0 0 auto" } });
  }
  function btn(label, onClick, opts) {
    const o = opts || {};
    return h("button", {
      onClick,
      disabled: o.disabled,
      title: o.title || label,
      className: "tether-press",
      style: {
        height: 28,
        padding: "0 10px",
        borderRadius: 6,
        fontSize: 12,
        border: 0,
        background: o.primary ? C2.primary : C2.soft,
        color: o.primary ? C2.onPrimary : o.danger ? C2.red : C2.ink,
        cursor: o.disabled ? "not-allowed" : "pointer",
        opacity: o.disabled ? 0.5 : 1,
        whiteSpace: "nowrap"
      }
    }, label);
  }
  function deviceOs(device) {
    const caps = device.capabilities || {};
    if (caps.os_label) return caps.os_label;
    const raw = String(device.platform || "");
    const match = raw.match(/Windows-(?:\d+)-([\d.]+)/);
    if (match) {
      const build = match[1].split(".").pop();
      if (build && Number(build) >= 22e3) return "Windows 11 \xB7 " + build;
      if (build) return "Windows 10 \xB7 " + build;
    }
    return raw || "Unknown";
  }
  function DeviceSwitcher({ devices, value, onChange, onOpenNetwork }) {
    const [open, setOpen] = React2.useState(false);
    const root = React2.useRef(null);
    const current = devices.find((item2) => item2.device_id === value) || devices[0];
    React2.useEffect(() => {
      if (!open) return void 0;
      const onPointer = (event) => {
        if (root.current && !root.current.contains(event.target)) setOpen(false);
      };
      const onKey = (event) => {
        if (event.key === "Escape") setOpen(false);
      };
      document.addEventListener("pointerdown", onPointer);
      window.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("pointerdown", onPointer);
        window.removeEventListener("keydown", onKey);
      };
    }, [open]);
    if (!current) return h("span", { style: { color: C2.mute, fontSize: 12 } }, "no device");
    const item = (device) => h(
      "button",
      {
        key: device.device_id,
        role: "option",
        "aria-selected": device.device_id === value,
        onClick: () => {
          onChange(device.device_id);
          setOpen(false);
        },
        className: "tether-hover",
        style: { display: "flex", width: "100%", alignItems: "center", gap: 8, minHeight: 40, padding: "4px 8px", border: 0, borderRadius: 6, background: device.device_id === value ? C2.soft : "transparent", color: C2.ink, fontSize: 13, textAlign: "left", cursor: "pointer" }
      },
      dot(device.online),
      h(
        "span",
        { style: { minWidth: 0, display: "flex", flexDirection: "column", gap: 1, overflow: "hidden" } },
        h("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, device.name || device.device_id),
        h("span", { style: { fontSize: 10.5, color: C2.mute, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, deviceOs(device))
      ),
      h("span", { style: { marginLeft: "auto", fontSize: 10.5, color: device.online ? C2.green : C2.mute, whiteSpace: "nowrap" } }, device.online ? "\u5728\u7EBF" : "\u79BB\u7EBF")
    );
    return h(
      "div",
      { ref: root, style: { position: "relative", minWidth: 0 } },
      h(
        "button",
        {
          onClick: () => setOpen((value2) => !value2),
          title: "\u5207\u6362\u8BBE\u5907",
          "aria-haspopup": "listbox",
          "aria-expanded": open,
          className: "tether-hover tether-press",
          style: { height: 26, maxWidth: 220, display: "flex", alignItems: "center", gap: 6, padding: "0 7px", border: 0, borderRadius: 7, background: open ? C2.active : C2.soft, color: C2.ink, fontSize: 12, cursor: "pointer" }
        },
        dot(current.online),
        h("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, current.name || current.device_id),
        h(Glyph, { name: "chevronDown", size: 12 })
      ),
      open ? h("div", {
        onPointerDown: (event) => {
          event.preventDefault();
          setOpen(false);
        },
        style: { position: "fixed", inset: 0, zIndex: 70, background: "transparent" }
      }) : null,
      open ? h(
        "div",
        { role: "listbox", style: { position: "absolute", top: 32, left: 0, minWidth: 260, maxWidth: 320, maxHeight: 340, overflow: "auto", background: C2.layer1, borderRadius: 10, boxShadow: C2.shadow, padding: 4, zIndex: 80 } },
        devices.map(item),
        onOpenNetwork ? h("div", { style: { height: 1, background: C2.line, margin: "4px 2px" } }) : null,
        onOpenNetwork ? h(
          "button",
          { onClick: () => {
            setOpen(false);
            onOpenNetwork();
          }, className: "tether-hover", style: { display: "flex", width: "100%", alignItems: "center", gap: 8, height: 32, padding: "0 8px", border: 0, borderRadius: 6, background: "transparent", color: C2.ink, fontSize: 13, cursor: "pointer" } },
          h(Glyph, { name: "devices", size: 15 }),
          "\u4E92\u8054"
        ) : null
      ) : null
    );
  }
  function formatBytes(n) {
    if (n == null) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }
  function normPath(p) {
    return String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  }
  function treeCacheKey(deviceId, path) {
    return String(deviceId || "") + "|" + normPath(path);
  }
  function treeNodeId(deviceId, groupId, workspaceId, path) {
    return [deviceId, groupId, workspaceId || "", normPath(path)].join("|");
  }
  function treeResponseIsCurrent(requestDevice, currentDevice, requestEpoch, currentEpoch) {
    return requestDevice === currentDevice && requestEpoch === currentEpoch;
  }
  function pathBasename(path) {
    return String(path || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(path || "");
  }
  function joinPath(base, name) {
    return String(base || "").replace(/[\\/]+$/, "") + "\\" + String(name || "");
  }
  function pathSegments(target) {
    const clean = String(target || "").replace(/[\\/]+$/, "");
    if (!clean) return [];
    const drive = clean.match(/^([A-Za-z]:)(.*)$/);
    const out = [];
    let cursor = "";
    if (drive) {
      cursor = drive[1] + "\\";
      out.push({ label: drive[1], path: cursor });
    }
    const rest = drive ? drive[2] : clean;
    rest.split(/[\\/]+/).filter(Boolean).forEach((part) => {
      cursor = cursor ? cursor.replace(/[\\/]+$/, "") + "\\" + part : part;
      out.push({ label: part, path: cursor });
    });
    return out;
  }
  function formatMtime(seconds) {
    if (!seconds) return "";
    const date = new Date(seconds * 1e3);
    return date.toLocaleDateString([], { month: "2-digit", day: "2-digit" }) + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function entryTypeLabel(entry) {
    if (entry.dir) return "\u6587\u4EF6\u5939";
    const suffix = String(entry.name || "").split(".").pop();
    return suffix && suffix !== entry.name ? suffix.toUpperCase() + " \u6587\u4EF6" : "\u6587\u4EF6";
  }
  function resolveSessionTarget(selectedNativeId, currentRun, nativeSessions, remoteSessions, remoteRuns, deviceId, workspace, runWorkspace) {
    if (selectedNativeId) {
      const nativeSession = nativeSessions.find((session) => session.session_id === selectedNativeId);
      const linkedRun = remoteRuns.find((run) => run.device_id === deviceId && samePath(run.workspace || workspace, workspace) && ((run.outcome || {}).dsh_session === selectedNativeId || "tether-" + run.session_id === selectedNativeId));
      const remoteSession = linkedRun && remoteSessions.find((session) => session.session_id === linkedRun.session_id && session.device_id === deviceId && samePath(session.workspace, workspace));
      return nativeSession && remoteSession ? { sessionId: remoteSession.session_id } : { blocked: true };
    }
    if (currentRun) {
      if (currentRun.device_id !== deviceId || !samePath(runWorkspace, workspace)) return { blocked: true };
      return { sessionId: currentRun.session_id };
    }
    return null;
  }
  function isNewSessionId(sessionId, existingSessions) {
    return !!sessionId && !existingSessions.some((session) => session.session_id === sessionId);
  }
  function toggleWorkspaceOpen(open, path) {
    return { ...open, [path]: open[path] === false ? true : false };
  }
  function selectWorkspaceState(lastProject, current, workspace, selection) {
    const changed = current.projectPath !== workspace.path;
    const next = {
      projectPath: workspace.path,
      path: workspace.path,
      pathDraft: workspace.path,
      file: changed ? null : current.file,
      sessionId: selection && selection.type === "session" ? selection.id : changed ? "" : current.sessionId,
      runId: selection && selection.type === "run" ? selection.id : changed ? "" : current.runId
    };
    lastProject.current = next.projectPath;
    return next;
  }
  function samePath(a, b) {
    const na = normPath(a), nb = normPath(b);
    if (!na || !nb) return false;
    return na === nb || !na.includes("/") && nb.endsWith("/" + na);
  }
  function timeText(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  function shortText(text, n) {
    const line = String(text || "").replace(/\s+/g, " ").trim();
    return line.length > n ? line.slice(0, n) + "\u2026" : line;
  }
  function nativeTranslate(dictionary) {
    return (key, values) => {
      let value = dictionary[key] || key;
      for (const [name, replacement] of Object.entries(values || {})) value = value.replaceAll("{" + name + "}", String(replacement));
      return value;
    };
  }
  const chatT = nativeTranslate({
    ...Native.chatZh,
    copy: "\u590D\u5236",
    copied: "\u5DF2\u590D\u5236",
    "codeBlock.title": "\u4EE3\u7801",
    "codeBlock.wrap": "\u81EA\u52A8\u6362\u884C",
    "codeBlock.unwrap": "\u5173\u95ED\u81EA\u52A8\u6362\u884C",
    "markdown.footnotes": "\u811A\u6CE8"
  });
  const workspaceT = nativeTranslate(Native.workspaceZh);
  const toolT = nativeTranslate(Native.toolZh);
  const nativeMarkdownLabels = Native.markdownLabels(chatT);
  function Markdown({ text, secondary, streaming }) {
    const source = String(text || "");
    if (!source) return null;
    return h(
      "div",
      { className: "tether-md" + (secondary ? " tether-md-secondary" : "") },
      h(Native.MarkdownText, { text: source, labels: nativeMarkdownLabels, streaming: !!streaming })
    );
  }
  function useNativeDisclosure() {
    const [expanded, setExpanded] = React2.useState(false);
    return { expanded, toggle: () => setExpanded((current) => !current) };
  }
  function toolArguments(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = null;
    }
    const values = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    const text = (key) => typeof values[key] === "string" ? values[key] : void 0;
    return { text, complete: (key) => text(key) !== void 0 };
  }
  function renderNativeMarkdown(_name, props) {
    return h(Markdown, { text: props && props.text, secondary: true, streaming: props && props.running });
  }
  function NativeReasoningRow({ text, running }) {
    return h(Native.ReasoningRow, {
      text: String(text || ""),
      running: !!running,
      useDisclosure: useNativeDisclosure,
      usePresentation: (select) => select({ settledReasoningPreview: true }),
      renderSlot: renderNativeMarkdown,
      t: chatT
    });
  }
  function ProcessRow({ block, streaming }) {
    const isThink = block.type === "reasoning";
    if (isThink) return h(
      "div",
      { className: "tether-proc" },
      h(NativeReasoningRow, { text: block.text, running: block.status === "running" || streaming })
    );
    const argsRaw = typeof block.arguments === "string" ? block.arguments : "";
    const args = toolArguments(argsRaw);
    const name = block.name || "tool";
    const callId = String(block.id || "");
    const toolBlock = block.status === "running" ? { phase: "start", name, argsRaw, callId, args } : {
      kind: "tool-result",
      call: { name, argsRaw },
      args,
      content: block.result ? [{ type: "text", text: String(block.result) }] : [],
      isError: !!(block.is_error || block.status === "error"),
      callId
    };
    return h(
      "div",
      { className: "tether-proc" },
      h(Native.GenericToolCard, {
        toolName: name,
        block: toolBlock,
        cwd: void 0,
        home: void 0,
        useDisclosure: useNativeDisclosure,
        t: toolT
      })
    );
  }
  function turnRunning(turn, live) {
    if (turn.state === "running") return true;
    if (turn.ended_at) return false;
    return !!live;
  }
  function ProcessGroup({ blocks, turn, live, latest }) {
    const [open, setOpen] = React2.useState(false);
    const [groupOpen, setGroupOpen] = React2.useState(false);
    const bodyId = React2.useId();
    const running = turnRunning(turn, live);
    const list = blocks || [];
    if (running) {
      if (!list.length) return null;
    }
    const stopped = turn.state === "cancelled" || turn.state === "aborted" || turn.state === "interrupted";
    const failed = turn.state === "failed" || turn.state === "error";
    const startedAt = turn.started_at ? turn.started_at * 1e3 : void 0;
    const endedAt = turn.ended_at ? turn.ended_at * 1e3 : void 0;
    const reason = stopped ? "interrupted" : failed ? "error" : "completed";
    const processNode = {
      kind: "turn-process",
      location: { kind: "turn", turn: {
        status: "closed",
        start: startedAt === void 0 ? void 0 : { time: startedAt },
        end: endedAt === void 0 ? void 0 : { time: endedAt, data: { reason: { kind: reason } } }
      } },
      data: { turn: turn.turn, messageCount: 0, toolCallCount: list.filter((b) => b.type === "tool").length, subagentCount: 0 }
    };
    const processState = { foldable: list.length > 0, open, hasContent: list.length > 0, setOpen };
    const toolCount = list.filter((block) => block.type === "tool").length;
    const groupData = {
      closed: !running,
      summary: {
        counts: [{ kind: toolCount ? "tools" : "thinking", count: toolCount || list.filter((block) => block.type === "reasoning").length }],
        running: toolCount ? "tools" : "thinking",
        runningDetail: "",
        preparing: false
      }
    };
    const useChatGroup = (_groupKey, select) => select({ data: groupData });
    const usePresentation = (select) => select({ liveProcessDetail: false });
    const toggleGroup = () => setGroupOpen((current) => !current);
    return h(
      "div",
      { className: "tether-process tether-ink" },
      running ? null : h(Native.TurnProcessNodeView, { node: processNode, turnProcess: processState, t: chatT }),
      list.length ? h(
        "div",
        {
          className: Native.ChatGroupSeat_module_css_default.root,
          hidden: !running && !open,
          style: { display: running || open ? void 0 : "none" }
        },
        h("div", null, h(Native.ProcessGroupHeader, {
          groupKey: "tether:" + String(turn.turn),
          useChatGroup,
          usePresentation,
          t: chatT,
          open: groupOpen,
          bodyId,
          toggle: toggleGroup
        })),
        h("div", {
          id: bodyId,
          className: [Native.ChatGroupSeat_module_css_default.body, Native.ChatGroupSeat_module_css_default.expandedBody].join(" "),
          hidden: !groupOpen,
          style: { display: groupOpen ? void 0 : "none" }
        }, h("div", {
          className: Native.ChatGroupSeat_module_css_default.content,
          "data-step-process-content": true,
          "data-chat-flow": ""
        }, list.map((block, i) => h(ProcessRow, { key: i, block, streaming: running }))))
      ) : null
    );
  }
  function UserBubble({ text }) {
    const renderFactorySlot = (name, props) => {
      if (name === "conversation.chat.user.content") {
        return h(Native.UserContent, {
          ...props,
          loadImage: () => void 0,
          t: chatT,
          renderSlot: () => null,
          renderFactorySlot: (_textName, textProps) => h("span", null, textProps && textProps.text)
        });
      }
      return null;
    };
    return h(Native.UserStyleBubble, {
      content: [{ type: "text", text: String(text || "") }],
      loadImage: () => void 0,
      renderFactorySlot
    });
  }
  function RunningStatus({ startTime }) {
    return h(Native.RunningStatus, { startTime: startTime == null ? void 0 : startTime * 1e3, t: chatT });
  }
  function Turn({ turn, index, live, latest }) {
    const blocks = turn.blocks || [];
    const processBlocks = blocks.filter((block) => block.type === "reasoning" || block.type === "tool");
    const texts = blocks.filter((block) => block.type === "text");
    const running = turnRunning(turn, live);
    return h(
      "div",
      { className: "tether-turn" },
      turn.user ? h(UserBubble, { text: turn.user.text }) : null,
      h(ProcessGroup, { blocks: processBlocks, turn, live, latest }),
      texts.length ? h(
        "div",
        { className: "tether-body" },
        texts.map((block, i) => h("div", { key: i, className: "tether-answer tether-ink" }, h(Markdown, { text: block.text, streaming: running && i === texts.length - 1 })))
      ) : null,
      running ? h(RunningStatus, { startTime: turn.started_at, paused: false, hasOutput: blocks.length > 0 }) : null
    );
  }
  function Conversation({ data, loading, emptyText, live, sessionKey }) {
    const box = React2.useRef(null);
    const atBottom = React2.useRef(true);
    const activeSession = React2.useRef(sessionKey);
    const lastSnapshot = React2.useRef("");
    React2.useLayoutEffect(() => {
      const el = box.current;
      if (!el) return;
      const snapshot = JSON.stringify(data && data.turns || []);
      if (activeSession.current !== sessionKey) {
        activeSession.current = sessionKey;
        lastSnapshot.current = snapshot;
        el.scrollTop = el.scrollHeight;
        atBottom.current = true;
        return;
      }
      if (snapshot !== lastSnapshot.current) {
        lastSnapshot.current = snapshot;
        if (atBottom.current) el.scrollTop = el.scrollHeight;
      }
    }, [data, sessionKey]);
    const turns = data && data.turns || [];
    if (!turns.length) {
      return h("div", { style: { display: "grid", placeItems: "center", flex: "1 1 auto", color: C2.mute, fontSize: 13, padding: 30 } }, loading ? "\u52A0\u8F7D\u4E2D\u2026" : emptyText);
    }
    return h(
      "div",
      {
        ref: box,
        className: "tether-scroll",
        onScroll: (event) => {
          const el = event.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
        },
        style: { flex: "1 1 auto", overflow: "auto", padding: "16px 0 24px" }
      },
      h(
        "div",
        { className: "tether-flow" },
        turns.map((turn, i) => h(Turn, { key: i, turn, index: i, live, latest: i === turns.length - 1 }))
      )
    );
  }
  function Composer({ value, onChange, onSend, busy, disabled, note, action, placeholder }) {
    return h(
      "div",
      { style: { width: "100%", maxWidth: "calc(var(--dsh-chat-content-width, 748px) + 32px)", boxSizing: "border-box", padding: "8px 16px 10px", margin: "0 auto", flex: "0 0 auto", background: C2.bg } },
      note || action ? h(
        "div",
        { style: { display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "4px 10px", color: C2.mute, fontSize: 10.5, margin: "0 2px 5px" } },
        note ? h("span", null, note) : h("span"),
        action || null
      ) : null,
      h(
        "div",
        { style: { width: "100%", boxSizing: "border-box", display: "flex", gap: 8, alignItems: "flex-end", border: 0, borderRadius: 12, padding: 7, background: C2.panel } },
        h("textarea", {
          value,
          onChange: (ev) => onChange(ev.target.value),
          disabled,
          onKeyDown: (ev) => {
            if (ev.key === "Enter" && !ev.shiftKey) {
              ev.preventDefault();
              onSend();
            }
          },
          placeholder: placeholder || (disabled ? "\u9009\u62E9\u9879\u76EE\u540E\u53EF\u53D1\u8D77\u4EFB\u52A1" : "\u53D1\u6D88\u606F\u6216\u53D1\u8D77\u4EFB\u52A1\u2026"),
          style: { flex: "1 1 0", width: 0, minWidth: 0, minHeight: 38, maxHeight: 160, resize: "none", border: 0, outline: "none", padding: "6px 8px", fontSize: 13.5, lineHeight: "20px", fontFamily: "inherit", background: "transparent" }
        }),
        h("button", {
          onClick: onSend,
          disabled: disabled || busy || !value.trim(),
          title: "\u53D1\u9001",
          className: "tether-press",
          style: { width: 34, height: 34, borderRadius: 17, border: 0, background: disabled || busy || !value.trim() ? C2.soft : C2.primary, color: disabled || busy || !value.trim() ? C2.mute : C2.onPrimary, cursor: disabled || busy || !value.trim() ? "not-allowed" : "pointer", fontSize: 16, flex: "0 0 auto" }
        }, "\u2191")
      )
    );
  }
  const SCROLL_CSS = `
      .tether-root { --tether-strong: 600; --tether-strong-2: 650; --tether-body: 400; }
      body[data-ds-dark-theme] .tether-root { --tether-strong: 500; --tether-strong-2: 520; --tether-body: 350; }
      .tether-scroll { scrollbar-width: thin; scrollbar-color: transparent transparent; overscroll-behavior: contain; }
      .tether-scroll:hover { scrollbar-color: var(--dsw-alias-scrollbar-hover-l1, #cbd5e1) transparent; }
      .tether-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
      .tether-scroll::-webkit-scrollbar-track { background: transparent; }
      .tether-scroll::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
      .tether-scroll:hover::-webkit-scrollbar-thumb { background: var(--dsw-alias-scrollbar-hover-l1, #cbd5e1); }
      .tether-scroll::-webkit-scrollbar-corner { background: transparent; }
      .tether-num { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1; }
      .tether-spin { animation: tether-spin .8s linear infinite; }
      @keyframes tether-spin { to { transform: rotate(360deg); } }
      .tether-node-fill { position: absolute; inset: 0; z-index: 1; border-radius: 50%; corner-shape: round; transition: background-color 160ms ease; }
      .tether-file-markdown { max-width: 860px; margin: 0 auto; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 24px; }
      .tether-file-text { tab-size: 2; }
      @media (prefers-reduced-motion: reduce) { .tether-spin { animation-duration: 1.6s; } }
      .tether-flow { display: flex; flex-direction: column; max-width: calc(var(--dsh-chat-content-width, 748px) + 32px); width: 100%; margin: 0 auto; padding: 0 16px; box-sizing: border-box; }
      .tether-turn { display: flex; flex-direction: column; min-width: 0; }
      .tether-turn + .tether-turn { margin-top: 24px; }
      .tether-process { display: flex; flex-direction: column; min-width: 0; }
      .tether-md { min-width: 0; color: var(--dsw-alias-label-primary); }
      .tether-md-secondary { color: var(--dsw-alias-label-secondary); }
      .tether-proc-list { display: flex; flex-direction: column; gap: 4px; padding: 0 0 4px; }
      .tether-proc { display: flex; flex-direction: column; min-width: 0; }
      .tether-body { display: flex; flex-direction: column; gap: 16px; }
      .tether-process + .tether-body { margin-top: 12px; }
      .tether-answer { min-width: 0; }
      .tether-ink { animation: tether-ink 300ms cubic-bezier(.2,.7,.2,1) both; }
      @keyframes tether-ink {
        from { opacity: 0; filter: blur(3px); transform: translateY(4px); }
        to { opacity: 1; filter: blur(0); transform: translateY(0); }
      }
      .tether-press { transition: transform 120ms cubic-bezier(.2,.8,.2,1.2), background-color 120ms ease; }
      .tether-press:active { transform: scale(.97); }
      .tether-press:hover { filter: brightness(.97); }
      body[data-ds-dark-theme] .tether-press:hover { filter: brightness(1.08); }
      .tether-root button:focus-visible, .tether-root [role=button]:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #1570ef); outline-offset: 2px; }
      .tether-hover:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38,49,72,.06)) !important; }
      .tether-resizer { position: relative; }
      .tether-drawer { width: min(480px, 100%); }
      .tether-drawer-body { padding: 16px; }
      .tether-audit-head { display: grid; grid-template-columns: 54px minmax(0, 1fr) 64px; gap: 6px; padding: 5px 8px; background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06)); font-size: 10px; color: var(--dsw-alias-label-tertiary, #667085); }
      .tether-audit-row { display: grid; grid-template-columns: 54px minmax(0, 1fr) 64px; gap: 6px; padding: 4px 8px; font-size: 10.5px; }
      @media (max-width: 760px) {
        .tether-drawer { width: 100%; }
        .tether-drawer-body { padding: 12px; }
        .tether-audit-head, .tether-audit-row { grid-template-columns: 46px minmax(0, 1fr) 54px; gap: 4px; }
      }
      @media (max-width: 520px) {
        .tether-audit-head, .tether-audit-row { grid-template-columns: 40px minmax(0, 1fr) 48px; gap: 3px; font-size: 9.5px; }
      }
      @media (prefers-reduced-motion: reduce) { .tether-ink { animation: none; } .tether-press { transition: none; } }
    `;
  const UI = {
    activity: 44,
    row: 32,
    pad: 8,
    radius: "var(--dsw-radius-md, 8px)",
    radiusCard: 8,
    icon: 16,
    font: 14,
    header: 12,
    gapRow: 1,
    gapGroup: 10,
    minSide: 210,
    maxSide: 420,
    defaultSide: 280
  };
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function usePersisted(key, initial) {
    const [value, setValue] = React2.useState(() => {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? initial : JSON.parse(raw);
      } catch (_) {
        return initial;
      }
    });
    React2.useEffect(() => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch (_) {
      }
    }, [key, value]);
    return [value, setValue];
  }
  const GLYPHS2 = {
    workspace: { cap: "round", join: "round", parts: [
      { d: "M14 12.05c0 .8-.65 1.45-1.46 1.45H3.46C2.65 13.5 2 12.85 2 12.05v-8.1c0-.8.65-1.45 1.46-1.45h2.4c.49 0 .94.24 1.21.65l.5.73c.27.4.73.65 1.21.65h3.76c.8 0 1.46.65 1.46 1.45v6.02Z" },
      { d: "M8.7 8.1v3M11.2 8.1v3" }
    ] },
    files: { parts: [
      { d: "M12.3994 13.5986H2.04956C1.49728 13.5986 1.04956 13.1509 1.04956 12.5986V3.40137C1.04956 2.84908 1.49728 2.40137 2.04956 2.40137H4.76632C5.01016 2.40137 5.24561 2.49046 5.42836 2.6519L6.94088 3.98799C7.12364 4.14943 7.35908 4.23852 7.60293 4.23852H12.3994C12.9517 4.23852 13.3994 4.68624 13.3994 5.23852V7.16991" },
      { d: "M2.55911 7.93683C2.67584 7.49906 3.07229 7.19446 3.52536 7.19446H13.6491C14.3061 7.19446 14.7846 7.81725 14.6153 8.45209L13.4411 12.856C13.3244 13.2938 12.9279 13.5984 12.4748 13.5984H2.35113C1.69411 13.5984 1.21562 12.9756 1.38489 12.3407L2.55911 7.93683Z" }
    ] },
    devices: { parts: [
      { d: "M7.99986 14.0887C11.3626 14.0887 14.0886 11.3627 14.0886 7.99998C14.0886 4.63727 11.3626 1.91125 7.99986 1.91125C4.63715 1.91125 1.91113 4.63727 1.91113 7.99998C1.91113 11.3627 4.63715 14.0887 7.99986 14.0887Z" },
      { d: "M2.34619 8H13.6538", cap: "square" },
      { d: "M7.99976 14.0889C9.23509 14.0889 10.1743 11.3629 10.1743 8.00006C10.1743 4.63739 9.23509 1.91138 7.99976 1.91138" },
      { d: "M7.99973 14.0889C6.76445 14.0889 5.8252 11.3629 5.8252 8.00006C5.8252 4.63739 6.76445 1.91138 7.99973 1.91138" }
    ] },
    settings: { join: "round", parts: [
      { d: "M6.80132 2.14853C7.70663 1.80917 8.70422 1.80919 9.60952 2.14859L14.1296 3.84317V7.11961C14.1296 11.6089 10.7615 13.5975 8.20543 14.5779C5.64931 13.5975 2.28052 11.6089 2.28052 7.11961V3.84317L6.80132 2.14853Z" }
    ] },
    monitor: { parts: [
      { d: "M2 3.2h12v8.1H2z" },
      { d: "M6 13.8h4M8 11.3v2.5" }
    ] },
    refresh: { parts: [
      { d: "M13 8a5 5 0 1 1-1.5-3.56" },
      { d: "M13.2 2.3v3.1h-3.1" }
    ] },
    pencil: { parts: [
      { d: "M10.8 2.6l2.6 2.6-7.7 7.7-3.4.8.8-3.4z" },
      { d: "M9.4 4l2.6 2.6" }
    ] },
    trash: { parts: [
      { d: "M2.8 4.2h10.4M6 4.2V2.6h4v1.6M4.1 4.2l.7 9.2h6.4l.7-9.2" },
      { d: "M6.8 6.7v4.6M9.2 6.7v4.6" }
    ] },
    arrowUp: { parts: [
      { d: "M8 13V3M3.6 7.4L8 3l4.4 4.4" }
    ] },
    back: { parts: [
      { d: "M10.2 3.2L5.4 8l4.8 4.8" }
    ] },
    save: { parts: [
      { d: "M3 2.4h8.2L13.4 4.6v9H3z" },
      { d: "M5.4 2.4v3.2h5V2.4" },
      { d: "M5.4 9.2h5.2v4.4H5.4z" }
    ] },
    plus: { parts: [
      { d: "M8 2V14" },
      { d: "M2 8H14" }
    ] },
    chevronDown: { parts: [
      { d: "M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6" }
    ] },
    chevronRight: { parts: [
      { d: "M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4" }
    ] },
    chevronLeft: { parts: [
      { d: "M10 4L6.70711 7.29289C6.31658 7.68342 6.31658 8.31658 6.70711 8.70711L10 12" }
    ] },
    think: { parts: [
      { d: "M10.2854 5.71481C12.9673 8.39663 14.1182 11.5938 12.8562 12.8559C11.5942 14.1179 8.39706 12.9669 5.71518 10.2851C3.03333 7.60323 1.88236 4.40608 3.14441 3.14403C4.40644 1.882 7.6036 3.03297 10.2854 5.71481Z" },
      { d: "M10.2854 10.2851C7.6036 12.9669 4.40644 14.1179 3.14441 12.8559C1.88236 11.5938 3.03333 8.39663 5.71518 5.71481C8.39706 3.03297 11.5942 1.882 12.8562 3.14403C14.1182 4.40608 12.9673 7.60323 10.2854 10.2851Z" },
      { d: "M8.86291 8.0002C8.86291 8.47549 8.47762 8.86087 8.00224 8.86087C7.52694 8.86087 7.1416 8.47549 7.1416 8.0002C7.1416 7.52485 7.52694 7.13953 8.00224 7.13953C8.47762 7.13953 8.86291 7.52485 8.86291 8.0002Z", fill: "currentColor", stroke: false }
    ] },
    tool: { parts: [
      { d: "M6.27612 1.5L4.52612 14.5" },
      { d: "M11.4739 1.5L9.72388 14.5" },
      { d: "M2.39868 5.5H14.0681" },
      { d: "M1.93188 10.5H13.6013" }
    ] },
    file: { parts: [
      { d: "M4.9375 5.90295H11.0625" },
      { d: "M4.9375 9.02991H8.27841" },
      { d: "M12.5 1.32617C13.3039 1.32617 14 1.95171 14 2.77637V13.2246C13.9996 14.0489 13.3036 14.6738 12.5 14.6738H3.5C2.69637 14.6738 2.00042 14.0489 2 13.2246V2.77637C2 1.95171 2.69613 1.32617 3.5 1.32617H12.5ZM3.5 2.32617C3.1993 2.32617 3 2.55186 3 2.77637V13.2246C3.00044 13.4489 3.19963 13.6738 3.5 13.6738H12.5C12.8004 13.6738 12.9996 13.4489 13 13.2246V2.77637C13 2.55186 12.8007 2.32617 12.5 2.32617H3.5Z", fill: "currentColor", stroke: false }
    ] },
    folderOpen: { parts: [
      { d: "M2.55912 7.93683C2.67584 7.49906 3.0723 7.19446 3.52536 7.19446H13.6491C14.3061 7.19446 14.7846 7.81725 14.6153 8.45209L13.4411 12.856C13.3244 13.2938 12.9279 13.5984 12.4748 13.5984H2.35113C1.69411 13.5984 1.21562 12.9756 1.38489 12.3407L2.55912 7.93683Z", fill: "currentColor", opacity: 0.16, stroke: false },
      { d: "M13.6491 6.69446C14.6346 6.69453 15.3522 7.62895 15.0983 8.58118L13.9245 12.9845C13.7494 13.6412 13.1539 14.0988 12.4743 14.0988H2.35126C1.36574 14.0988 0.648153 13.1643 0.902044 12.212L2.07587 7.80774C2.25102 7.15128 2.84567 6.69455 3.52509 6.69446H13.6491ZM3.52509 7.69446C3.29865 7.69455 3.10004 7.84674 3.04169 8.06555L1.86786 12.4698C1.78345 12.7872 2.02285 13.0988 2.35126 13.0988H12.4743C12.7007 13.0988 12.8992 12.9463 12.9577 12.7277L14.1325 8.32336C14.2171 8.00598 13.9776 7.69453 13.6491 7.69446H3.52509Z", fill: "currentColor", stroke: false },
      { d: "M4.7666 1.90137C5.13227 1.90144 5.48571 2.03525 5.75977 2.27734L7.27246 3.61328C7.36379 3.69382 7.48174 3.73828 7.60352 3.73828H12.3994C13.2276 3.73841 13.8993 4.41005 13.8994 5.23828V6.7168C13.8183 6.70327 13.735 6.69436 13.6494 6.69434H12.8994V5.23828C12.8993 4.96233 12.6754 4.73841 12.3994 4.73828H7.60352C7.23781 4.73828 6.88446 4.60438 6.61035 4.3623L5.09766 3.02637C5.00636 2.94576 4.88838 2.90144 4.7666 2.90137H2.0498C1.77366 2.90137 1.5498 3.12523 1.5498 3.40137V9.78223L0.902344 12.2119C0.648452 13.1642 1.36604 14.0986 2.35156 14.0986H2.0498C1.2214 14.0986 0.549838 13.427 0.549805 12.5986V3.40137C0.549805 2.57294 1.22138 1.90137 2.0498 1.90137H4.7666Z", fill: "currentColor", stroke: false }
    ] },
    folderClose: { parts: [
      { d: "M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z" },
      { d: "M3.63501 7.66614H12.3647" }
    ] }
  };
  function Glyph({ name, size = 16, stroke }) {
    const glyph = GLYPHS2[name] || { parts: [] };
    return h("svg", {
      width: size,
      height: size,
      viewBox: "0 0 16 16",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: stroke == null ? 1 : stroke,
      strokeLinecap: glyph.cap || "butt",
      strokeLinejoin: glyph.join || "miter",
      "aria-hidden": true
    }, glyph.parts.map((part, index) => h("path", {
      key: index,
      d: part.d,
      fill: part.fill || "none",
      stroke: part.stroke === false ? "none" : void 0,
      opacity: part.opacity,
      strokeLinecap: part.cap || glyph.cap || "butt"
    })));
  }
  function ActivityBar({ active, collapsed, onSelect, onSettings, settingsOpen }) {
    const items = [
      { id: "workspaces", label: "\u539F\u751F\u5DE5\u4F5C\u533A", icon: "monitor" },
      { id: "files", label: "\u6587\u4EF6\u8D44\u6E90\u7BA1\u7406\u5668", icon: "files" },
      { id: "network", label: "\u4E92\u8054", icon: "devices" }
    ];
    const button = (id, label, icon, onClick, selected) => h("button", {
      key: id,
      title: label,
      "aria-label": label,
      onClick,
      className: "tether-press tether-hover",
      style: {
        width: 36,
        height: 36,
        display: "grid",
        placeItems: "center",
        border: 0,
        borderRadius: UI.radius,
        cursor: "pointer",
        position: "relative",
        background: selected ? C2.layer1 : "transparent",
        color: selected ? C2.ink : C2.mute,
        boxShadow: selected ? "0 1px 2px rgba(16,24,40,0.08)" : "none"
      }
    }, h(Glyph, { name: icon, size: 18 }));
    return h(
      "nav",
      {
        "aria-label": "Tether \u9762\u677F",
        style: { width: UI.activity, flex: "0 0 auto", borderRight: 0, background: C2.soft, display: "flex", flexDirection: "column", alignItems: "center", padding: "6px 0", gap: 2 }
      },
      items.map((item) => button(item.id, item.label, item.icon, () => onSelect(item.id), active === item.id)),
      h("div", { style: { marginTop: "auto" } }, button("settings", "\u6587\u4EF6\u6743\u9650", "settings", onSettings, settingsOpen))
    );
  }
  function SidePanelHeader({ title, action, onCollapse, loading }) {
    return h(
      "div",
      { style: { display: "flex", alignItems: "center", height: 36, flex: "0 0 auto", padding: "0 " + UI.pad + "px", gap: 4 } },
      h("span", { style: { fontSize: 13, lineHeight: "20px", fontWeight: "var(--tether-body, 400)", color: C2.mute } }, title),
      h(
        "span",
        { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 2 } },
        loading ? h("span", { className: "tether-spin", style: { width: 14, height: 14, display: "grid", placeItems: "center", color: C2.mute } }, h(Glyph, { name: "refresh", size: 14 })) : null,
        action,
        h("button", {
          title: "\u6536\u8D77\u4FA7\u680F",
          "aria-label": "\u6536\u8D77\u4FA7\u680F",
          onClick: onCollapse,
          className: "tether-hover",
          style: { width: 26, height: 26, display: "grid", placeItems: "center", border: 0, borderRadius: UI.radius, background: "transparent", color: C2.mute, cursor: "pointer" }
        }, h(Glyph, { name: "chevronLeft", size: 14 }))
      )
    );
  }
  function SideRow({ selected, title, hint, icon, iconColor, onClick, right, indent = 0, action, actionTitle, onAction, toggle, onToggle }) {
    return h(
      "div",
      {
        role: "button",
        tabIndex: 0,
        title,
        onClick,
        className: "tether-press tether-hover",
        onKeyDown: (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            onClick();
          }
        },
        style: {
          display: "flex",
          alignItems: "center",
          gap: 6,
          minHeight: UI.row,
          boxSizing: "border-box",
          padding: "5px " + UI.pad + "px 5px " + (UI.pad + indent * 14) + "px",
          borderRadius: UI.radius,
          cursor: "pointer",
          minWidth: 0,
          width: "100%",
          background: selected ? C2.active : "transparent",
          fontSize: UI.font,
          color: C2.ink
        }
      },
      toggle ? h("button", {
        title: toggle ? "\u5C55\u5F00/\u6536\u8D77" : "",
        "aria-label": "\u5C55\u5F00/\u6536\u8D77",
        onClick: (ev) => {
          ev.stopPropagation();
          onToggle();
        },
        className: "tether-hover",
        style: { width: 18, height: 18, flex: "0 0 auto", display: "grid", placeItems: "center", border: 0, borderRadius: 4, background: "transparent", color: C2.mute, cursor: "pointer" }
      }, h(Glyph, { name: toggle, size: 14 })) : null,
      icon ? h("span", { style: { width: UI.icon, height: UI.icon, display: "grid", placeItems: "center", color: iconColor || C2.mute, flex: "0 0 auto" } }, typeof icon === "string" ? h(Glyph, { name: icon, size: 16 }) : icon) : null,
      h("span", { style: { minWidth: 0, flex: "1 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: "18px" } }, title),
      right ? h("span", { className: "tether-num", style: { flex: "0 0 auto", fontSize: 10, color: C2.mute, whiteSpace: "nowrap" } }, right) : null,
      action ? h("button", {
        title: actionTitle || action,
        "aria-label": actionTitle || action,
        onClick: (ev) => {
          ev.stopPropagation();
          if (onAction) onAction();
        },
        className: "tether-hover",
        style: { width: 24, height: 24, flex: "0 0 auto", display: "grid", placeItems: "center", border: 0, borderRadius: 5, background: "transparent", color: C2.mute, cursor: "pointer" }
      }, typeof action === "string" ? h(Glyph, { name: action, size: 16, stroke: 1.8 }) : action) : null,
      hint ? h("span", { style: { flex: "0 0 auto", fontSize: 9.5, color: C2.mute, border: 0, borderRadius: 999, padding: "0 5px", lineHeight: "15px", background: C2.bg } }, hint) : null
    );
  }
  function NativeSessionRow({ session, selected, onClick }) {
    const node = {
      id: session.session_id,
      title: session.title || "",
      blank: session.type === "fresh",
      running: session.status === "running" || session.state === "running",
      runningSubagentCount: 0,
      completed: false,
      pinned: false,
      archived: session.status === "archived",
      updatedAt: (session.updated_at || 0) * 1e3,
      cwd: session.cwd || session.workspace || void 0
    };
    return h(Native.SessionNodeItem, {
      node,
      currentId: selected ? node.id : void 0,
      now: Date.now(),
      onOpen: onClick,
      renderSlot: () => null,
      disableActions: true,
      useSessionAccess: () => false,
      t: workspaceT
    });
  }
  function NetworkGraph({ devices, localId, selectedId, onSelect, onOpen, onContextMenu }) {
    const stage = React2.useRef(null);
    const nodesRef = React2.useRef([]);
    const dragRef = React2.useRef(null);
    const frameRef = React2.useRef(0);
    const centerIdRef = React2.useRef("");
    const [nodes, setNodes] = React2.useState([]);
    const [zoom, setZoom] = React2.useState(1);
    const posZoom = zoom <= 1 ? 0.72 + 0.28 * zoom : zoom;
    const key = devices.map((item) => item.device_id).join("|");
    const centerId = (devices.find((item) => item.device_id === localId) || devices[0] || {}).device_id || "";
    centerIdRef.current = centerId;
    const update = (next) => {
      nodesRef.current = next;
      setNodes(next);
    };
    const kick = () => {
      if (!frameRef.current) frameRef.current = requestAnimationFrame(animate);
    };
    React2.useEffect(() => {
      const center2 = devices.find((item) => item.device_id === localId) || devices[0];
      const remotes2 = center2 ? devices.filter((item) => item.device_id !== center2.device_id) : [];
      const radius = Math.min(40, 34 + remotes2.length * 2);
      const next = devices.map((item) => {
        const index = remotes2.findIndex((candidate) => candidate.device_id === item.device_id);
        const angle = index < 0 ? 0 : (-90 + index * (360 / Math.max(1, remotes2.length))) * Math.PI / 180;
        return { id: item.device_id, x: index < 0 ? 50 : 50 + Math.cos(angle) * radius, y: index < 0 ? 50 : 50 + Math.sin(angle) * radius, vx: 0, vy: 0 };
      });
      update(next);
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      kick();
    }, [key, localId]);
    React2.useEffect(() => {
      const el = stage.current;
      if (!el) return void 0;
      const onWheel = (event) => {
        event.preventDefault();
        setZoom((value) => clamp(value * Math.pow(0.998, event.deltaY), 0.4, 1.2));
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    }, []);
    React2.useEffect(() => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    }, []);
    function animate() {
      const list = nodesRef.current.map((node) => ({ ...node }));
      if (!list.length) {
        frameRef.current = 0;
        return;
      }
      const byId = new Map(list.map((node) => [node.id, node]));
      const center2 = byId.get(centerIdRef.current);
      const fx = new Map(list.map((node) => [node.id, 0]));
      const fy = new Map(list.map((node) => [node.id, 0]));
      let moving = false;
      for (const node of list) {
        if (dragRef.current && dragRef.current.id === node.id) continue;
        fx.set(node.id, fx.get(node.id) + (50 - node.x) * 6e-4);
        fy.set(node.id, fy.get(node.id) + (50 - node.y) * 6e-4);
        if (!center2 || node.id === center2.id) continue;
        const dx = center2.x - node.x;
        const dy = center2.y - node.y;
        const distance = Math.max(1e-3, Math.hypot(dx, dy));
        const pull = (distance - 40) * 35e-4 + Math.max(0, distance - 55) * 0.01;
        fx.set(node.id, fx.get(node.id) + dx / distance * pull);
        fy.set(node.id, fy.get(node.id) + dy / distance * pull);
        fx.set(center2.id, fx.get(center2.id) - dx / distance * pull * 0.22);
        fy.set(center2.id, fy.get(center2.id) - dy / distance * pull * 0.22);
      }
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const dx = list[j].x - list[i].x;
          const dy = list[j].y - list[i].y;
          const distance = Math.max(1e-3, Math.hypot(dx, dy));
          if (distance >= 15) continue;
          const push = (15 - distance) * 4e-3;
          fx.set(list[i].id, fx.get(list[i].id) - dx / distance * push);
          fy.set(list[i].id, fy.get(list[i].id) - dy / distance * push);
          fx.set(list[j].id, fx.get(list[j].id) + dx / distance * push);
          fy.set(list[j].id, fy.get(list[j].id) + dy / distance * push);
        }
      }
      for (const node of list) {
        if (dragRef.current && dragRef.current.id === node.id) {
          moving = true;
          continue;
        }
        node.vx = (node.vx + fx.get(node.id)) * 0.95;
        node.vy = (node.vy + fy.get(node.id)) * 0.95;
        node.x = clamp(node.x + node.vx, 4, 96);
        node.y = clamp(node.y + node.vy, 7, 93);
        if (node.x <= 4 || node.x >= 96) node.vx *= -0.35;
        if (node.y <= 7 || node.y >= 93) node.vy *= -0.35;
        if (Math.abs(node.vx) + Math.abs(node.vy) > 2e-3) moving = true;
      }
      update(list);
      frameRef.current = moving ? requestAnimationFrame(animate) : 0;
    }
    const startDrag = (event, item) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect(item);
      const node = nodesRef.current.find((candidate) => candidate.id === item.device_id);
      dragRef.current = { id: item.device_id, lastX: node ? node.x : 50, lastY: node ? node.y : 50, vx: 0, vy: 0 };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      kick();
    };
    const moveDrag = (event) => {
      const drag = dragRef.current;
      if (!drag || !stage.current) return;
      const rect = stage.current.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = clamp(50 + ((event.clientX - rect.left) / rect.width * 100 - 50) / posZoom, 4, 96);
      const y = clamp(50 + ((event.clientY - rect.top) / rect.height * 100 - 50) / posZoom, 7, 93);
      drag.vx = x - drag.lastX;
      drag.vy = y - drag.lastY;
      drag.lastX = x;
      drag.lastY = y;
      update(nodesRef.current.map((node) => node.id === drag.id ? { ...node, x, y, vx: drag.vx * 0.8, vy: drag.vy * 0.8 } : node));
      kick();
    };
    const endDrag = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      kick();
    };
    const screen = (node) => ({ x: 50 + (node.x - 50) * posZoom, y: 50 + (node.y - 50) * posZoom });
    const center = nodes.find((node) => node.id === centerId) || nodes[0];
    const remotes = center ? nodes.filter((node) => node.id !== center.id) : [];
    const lookup = new Map(devices.map((item) => [item.device_id, item]));
    const compact = zoom < 0.72;
    const linkPoints = (from, to, fromId, toId) => {
      const el = stage.current;
      const rect = el && el.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
      const a = { x: from.x / 100 * rect.width, y: from.y / 100 * rect.height };
      const b = { x: to.x / 100 * rect.width, y: to.y / 100 * rect.height };
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (!length) return null;
      const inset = (id) => {
        const isCenter = center && center.id === id;
        if (compact) return isCenter ? 9 : 6;
        return isCenter ? 14 : 3;
      };
      const start = inset(fromId);
      const end = inset(toId);
      if (length <= start + end + 1) return null;
      const ux = dx / length;
      const uy = dy / length;
      return {
        x1: (a.x + ux * start) / rect.width * 100,
        y1: (a.y + uy * start) / rect.height * 100,
        x2: (b.x - ux * end) / rect.width * 100,
        y2: (b.y - uy * end) / rect.height * 100
      };
    };
    const centerItem = center ? lookup.get(center.id) : null;
    return h(
      "div",
      { ref: stage, style: { position: "absolute", inset: 0, overflow: "hidden", touchAction: "none" } },
      h("div", { style: { position: "absolute", left: 14, top: 12, fontSize: 12, color: C2.mute } }, "\u7F51\u7EDC"),
      h(
        "svg",
        { viewBox: "0 0 100 100", preserveAspectRatio: "none", style: { position: "absolute", inset: 0, width: "100%", height: "100%" } },
        remotes.map((node) => {
          const item = lookup.get(node.id);
          const from = center ? screen(center) : { x: 50, y: 50 };
          const to = screen(node);
          const points = linkPoints(from, to, center && center.id, node.id);
          if (!points) return null;
          const linked = !!(centerItem && centerItem.online && item && item.online);
          return h("line", {
            key: "line:" + node.id,
            ...points,
            stroke: C2.sub,
            strokeWidth: zoom > 1 ? 1 : 1.2,
            vectorEffect: "non-scaling-stroke",
            strokeDasharray: linked ? void 0 : "4 5",
            opacity: linked ? 0.7 : 0.4
          });
        })
      ),
      nodes.map((node) => {
        const item = lookup.get(node.id) || { device_id: node.id, name: node.id, online: false };
        const isCenter = center && center.id === node.id;
        const selected = node.id === selectedId;
        const pos = screen(node);
        return h(
          "div",
          {
            key: "node:" + node.id,
            onPointerDown: (event) => startDrag(event, item),
            onPointerMove: moveDrag,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
            onDoubleClick: () => onOpen(item),
            onContextMenu: (event) => {
              event.preventDefault();
              event.stopPropagation();
              if (onContextMenu) onContextMenu(event, item);
            },
            title: item.name || item.device_id,
            style: compact ? {
              position: "absolute",
              left: pos.x + "%",
              top: pos.y + "%",
              transform: "translate(-50%, -50%)",
              zIndex: isCenter ? 3 : 2,
              width: isCenter ? 22 : 16,
              height: isCenter ? 22 : 16,
              borderRadius: "50%",
              cornerShape: "round",
              border: 0,
              padding: 0,
              background: "transparent",
              opacity: item.online ? 1 : 0.46,
              cursor: "grab",
              userSelect: "none"
            } : {
              position: "absolute",
              left: pos.x + "%",
              top: pos.y + "%",
              transform: "translate(-50%, -50%)",
              zIndex: isCenter ? 3 : 2,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: isCenter ? "8px 12px" : "6px 9px",
              borderRadius: 999,
              background: isCenter ? C2.ink : selected ? C2.nodeChildActive : C2.nodeChild,
              color: isCenter ? C2.onPrimary : C2.ink,
              fontSize: isCenter ? 12 : 11,
              boxShadow: isCenter ? C2.shadow : selected ? "0 1px 3px rgba(16,24,40,0.12)" : "0 1px 2px rgba(16,24,40,0.06)",
              transition: "background-color 160ms ease",
              cursor: "grab",
              whiteSpace: "nowrap",
              opacity: item.online ? 1 : 0.55,
              userSelect: "none"
            }
          },
          compact ? h("span", {
            className: "tether-node-fill",
            "data-center": isCenter ? "true" : void 0,
            "data-selected": selected ? "true" : void 0,
            style: {
              background: isCenter ? C2.ink : selected ? C2.nodeChildActive : C2.nodeChild,
              borderRadius: "50%",
              cornerShape: "round",
              pointerEvents: "none"
            }
          }) : h("span", { style: { width: 7, height: 7, borderRadius: 4, background: item.online ? C2.green : C2.mute, display: "inline-block", flex: "0 0 auto" } }),
          compact ? null : item.name || item.device_id
        );
      }),
      h("div", { onClick: () => setZoom(1), title: "\u91CD\u7F6E\u7F29\u653E", style: { position: "absolute", right: 12, bottom: 10, zIndex: 4, fontSize: 10, color: C2.mute, background: C2.layer1, borderRadius: 999, padding: "2px 7px", cursor: "pointer" } }, Math.round(zoom * 100) + "%"),
      !devices.length ? h("div", { style: { position: "absolute", inset: 0, display: "grid", placeItems: "center", color: C2.mute, fontSize: 12 } }, "\u6682\u65E0\u8BBE\u5907 \xB7 \u76EE\u6807\u673A\u9700\u63A5\u5165 Hub") : null
    );
  }
  function FileTree({ roots, children, open, onToggle, onOpenFile, onContextMenuNode, selected }) {
    const rows = [];
    const walk = (node, depth, ancestors) => {
      const isDir = node.dir !== false;
      const normalizedPath = normPath(node.path);
      const isCycle = isDir && ancestors.has(normalizedPath);
      const expanded = !isCycle && !!open[node.id];
      const cached = children[node.cacheKey];
      const kids = cached && cached.status === "loaded" ? cached.entries : void 0;
      const parentPath = String(node.path || "").replace(/[\\/]+$/, "").replace(/[\\/][^\\/]+$/, "");
      const entryName = node.name || pathBasename(node.path);
      const nativeRow = Native.FileEntryRow({
        parent: parentPath,
        entry: { name: entryName, type: isDir ? "directory" : "file" },
        tree: {
          state: { expanded: expanded ? [node.path, parentPath + "/" + entryName, parentPath + "\\" + entryName] : [] },
          onToggle: () => onToggle(node),
          onOpen: () => onOpenFile(node),
          t: (key) => key
        },
        expanded
      });
      const row = React2.cloneElement(nativeRow, {
        title: node.path,
        "data-tree-node-id": node.id,
        "aria-expanded": isDir ? expanded : void 0,
        className: nativeRow.props.className + " tether-press tether-hover",
        style: {
          ...nativeRow.props.style,
          marginLeft: depth * 12,
          borderRadius: "var(--dsw-radius-md)",
          background: selected === node.id ? C2.active : nativeRow.props.style && nativeRow.props.style.background,
          color: C2.ink,
          fontSize: 14
        }
      });
      rows.push(h(
        "div",
        {
          key: node.id,
          onContextMenu: (event) => {
            if (onContextMenuNode) onContextMenuNode(event, node);
          },
          style: { display: "flex", alignItems: "center", minWidth: 0 }
        },
        row,
        !isDir && node.size != null ? h("span", { className: "tether-num", style: { flex: "0 0 auto", paddingRight: 10, fontSize: 10, color: C2.mute } }, formatBytes(node.size)) : null
      ));
      if (isDir && expanded) {
        if (!cached || cached.status === "loading") rows.push(h("div", { key: node.id + ":loading", style: { padding: "3px " + UI.pad + "px 3px " + (UI.pad + (depth + 2) * 12) + "px", fontSize: 11.5, color: C2.mute } }, "\u52A0\u8F7D\u4E2D\u2026"));
        else if (cached.status === "error") rows.push(h("button", { key: node.id + ":error", onClick: (ev) => {
          ev.stopPropagation();
          onToggle(node, true);
        }, style: { border: 0, background: "transparent", padding: "3px " + UI.pad + "px 3px " + (UI.pad + (depth + 2) * 12) + "px", color: C2.red, fontSize: 11.5, cursor: "pointer" } }, "\u52A0\u8F7D\u5931\u8D25\uFF0C\u70B9\u51FB\u91CD\u8BD5"));
        else if (!kids.length) rows.push(h("div", { key: node.id + ":empty", style: { padding: "3px " + UI.pad + "px 3px " + (UI.pad + (depth + 2) * 12) + "px", fontSize: 11.5, color: C2.mute } }, "\u7A7A\u6587\u4EF6\u5939"));
        else {
          const nextAncestors = new Set(ancestors);
          nextAncestors.add(normalizedPath);
          const seen = /* @__PURE__ */ new Set();
          kids.forEach((child) => {
            const childPath = normPath(child.path);
            if (!childPath || seen.has(childPath) || nextAncestors.has(childPath)) return;
            seen.add(childPath);
            walk({ ...child, id: treeNodeId(node.deviceId, node.groupId, node.workspaceId, child.path), cacheKey: treeCacheKey(node.deviceId, child.path), deviceId: node.deviceId, groupId: node.groupId, workspaceId: node.workspaceId }, depth + 1, nextAncestors);
          });
        }
      }
    };
    const groupStyle = { display: "flex", alignItems: "center", height: 36, padding: "0 " + UI.pad + "px", fontSize: 13, lineHeight: "20px", fontWeight: "var(--tether-body, 400)", color: C2.mute };
    roots.forEach((group) => {
      rows.push(h("div", { key: "g:" + group.id, style: { ...groupStyle, marginTop: group.first ? 0 : 8 } }, group.label));
      (group.groups || []).forEach((subgroup) => {
        rows.push(h("div", { key: "g:" + subgroup.id, style: { ...groupStyle, marginTop: 8 } }, subgroup.label));
        subgroup.nodes.forEach((node) => walk(node, 0, /* @__PURE__ */ new Set()));
      });
      (group.nodes || []).forEach((node) => walk(node, 0, /* @__PURE__ */ new Set()));
    });
    return h("div", null, rows);
  }
  function SidePanel(props) {
    const {
      width,
      hidden,
      resizing,
      onResizeStart,
      onResetWidth,
      onCollapse,
      treeRoots,
      treeChildren,
      treeOpen,
      onToggleTree,
      onOpenFile,
      onContextMenuNode,
      treeSelected,
      loadingTree
    } = props;
    return h(
      "aside",
      {
        "aria-label": "\u6587\u4EF6",
        style: { display: hidden ? "none" : "flex", width, flex: "0 0 auto", minHeight: 0, borderRight: 0, background: C2.panel, flexDirection: "column", position: "relative", transition: resizing ? "none" : "width 180ms cubic-bezier(.2,.85,.2,1.15)", willChange: "width" }
      },
      h(SidePanelHeader, { title: "\u6587\u4EF6", onCollapse, loading: loadingTree }),
      h(
        "div",
        { className: "tether-scroll", style: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "0 " + UI.pad + "px " + UI.pad + "px" } },
        h(FileTree, {
          roots: treeRoots || [],
          children: treeChildren,
          open: treeOpen,
          selected: treeSelected,
          onToggle: onToggleTree,
          onOpenFile,
          onContextMenuNode
        })
      ),
      h("div", {
        className: "tether-resizer",
        "data-active": resizing ? "true" : void 0,
        onPointerDown: onResizeStart,
        onDoubleClick: onResetWidth,
        title: "\u62D6\u52A8\u8C03\u6574\u5BBD\u5EA6\uFF0C\u53CC\u51FB\u590D\u4F4D",
        style: { position: "absolute", top: 0, right: -3, width: 7, height: "100%", cursor: "col-resize", zIndex: 2 }
      })
    );
  }
  function nativeSurfaceStateForDevice(state, deviceId, online) {
    if (!deviceId) return { deviceId, status: "no-device", url: "" };
    if (!online) return { deviceId, status: "offline", url: "" };
    if (state && state.deviceId === deviceId && state.status !== "offline") return state;
    return { deviceId, status: "loading", url: "" };
  }
  function nativeSurfaceContainerStyle(visible) {
    return { display: visible ? "flex" : "none", flex: "1 1 auto", minWidth: 0, minHeight: 0, flexDirection: "column" };
  }
  function NativeSurface({ deviceId, online, visible }) {
    const [state, setState] = React2.useState({ deviceId, status: deviceId ? "loading" : "no-device", url: "" });
    const [attempt, setAttempt] = React2.useState(0);
    const currentState = nativeSurfaceStateForDevice(state, deviceId, online);
    React2.useEffect(() => {
      let current = true;
      if (!deviceId) {
        setState({ deviceId, status: "no-device", url: "" });
        return () => {
          current = false;
        };
      }
      if (!online) {
        setState({ deviceId, status: "offline", url: "" });
        return () => {
          current = false;
        };
      }
      setState({ deviceId, status: "loading", url: "" });
      fetch(ACTIVE_BASE + "/api/devices/" + encodeURIComponent(deviceId) + "/dsh/surface").then(async (response) => {
        let data = {};
        try {
          data = await response.json();
        } catch (_) {
        }
        if (!response.ok) {
          const detail = data.detail || {};
          const code = detail.code;
          const message2 = response.status === 404 ? "\u76EE\u6807\u8BBE\u5907\u4E0D\u5B58\u5728\u6216\u5DF2\u79FB\u9664" : code === "node_update_required" ? "\u76EE\u6807\u8282\u70B9\u7248\u672C\u8F83\u65E7\uFF0C\u9700\u8981\u66F4\u65B0\u540E\u624D\u80FD\u6253\u5F00\u5B8C\u6574 DSH \u5DE5\u4F5C\u533A" : code === "device_offline" ? "\u76EE\u6807\u8BBE\u5907\u79BB\u7EBF\u3002\u8BBE\u5907\u91CD\u65B0\u5728\u7EBF\u540E\u53EF\u91CD\u8BD5\u3002" : code === "descriptor_missing" ? "\u76EE\u6807\u8BBE\u5907\u7684 DeepSeek Harness \u672A\u8FD0\u884C\uFF0C\u6216\u6CA1\u6709\u5B89\u88C5 Tether surface \u7EC4\u4EF6\u3002\u8BF7\u5148\u542F\u52A8\u76EE\u6807 DSH\u3002" : code === "descriptor_invalid" ? "\u76EE\u6807\u8BBE\u5907\u7684 DSH surface \u63CF\u8FF0\u65E0\u6548\uFF0C\u8BF7\u91CD\u542F\u76EE\u6807 DSH \u6216\u91CD\u65B0\u5B89\u88C5\u63D2\u4EF6\u3002" : code === "host_unreachable" ? "\u76EE\u6807 DSH \u8FDB\u7A0B\u6CA1\u6709\u54CD\u5E94\uFF0C\u8BF7\u786E\u8BA4\u5B83\u5DF2\u542F\u52A8\u3002" : code === "auth_failed" ? "\u76EE\u6807 DSH \u7684\u767B\u5F55\u6001\u5DF2\u5931\u6548\uFF0C\u8BF7\u5728\u76EE\u6807\u673A\u91CD\u65B0\u767B\u5F55 DeepSeek Harness\u3002" : code === "surface_timeout" ? "\u76EE\u6807\u8BBE\u5907\u6CA1\u6709\u53CA\u65F6\u54CD\u5E94\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002" : "\u539F\u751F DSH \u9875\u9762\u6682\u4E0D\u53EF\u7528";
          throw new Error(message2);
        }
        if (!data.available || !isSafeNativeSurfaceUrl(data.url)) throw new Error("Controller \u8FD4\u56DE\u4E86\u65E0\u6548\u6216\u975E loopback \u7684\u539F\u751F\u9875\u9762\u5730\u5740");
        let surfaceUrl = data.url;
        const parsed = new URL(data.url);
        if ((parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]") && ACTIVE_BASE !== "http://127.0.0.1:18890") {
          let localOk = false;
          try {
            const localRes = await fetch(ACTIVE_BASE + "/local-api/api/devices/" + encodeURIComponent(deviceId) + "/dsh/surface");
            if (localRes.ok) {
              const localData = await localRes.json();
              if (localData.available && isSafeNativeSurfaceUrl(localData.url)) {
                surfaceUrl = localData.url;
                localOk = true;
              }
            }
          } catch (_) {
          }
          if (!localOk) throw new Error("\u8FDC\u7AEF Hub \u7684\u539F\u751F\u9875\u6307\u5411\u5176 loopback \u7F51\u5173\uFF0C\u8DE8\u673A\u4EE3\u7406\u5C1A\u672A\u5B9E\u73B0\uFF1B\u672C\u673A\u8BBE\u5907\u8BF7\u4FDD\u6301\u672C\u5730 Controller \u8FD0\u884C");
        }
        const url = new URL(surfaceUrl);
        url.searchParams.set("tether_native", "1");
        if (current) setState({ deviceId, status: "ready", url: url.href });
      }).catch((error) => {
        if (current) setState({ deviceId, status: "error", url: "", message: error.message });
      });
      return () => {
        current = false;
      };
    }, [deviceId, online, attempt]);
    const message = currentState.status === "loading" ? "\u6B63\u5728\u8FDE\u63A5\u76EE\u6807\u8BBE\u5907\u7684 DSH \u539F\u751F\u5DE5\u4F5C\u533A\u2026" : currentState.status === "offline" ? "\u76EE\u6807\u8BBE\u5907\u79BB\u7EBF\u3002\u8BBE\u5907\u91CD\u65B0\u5728\u7EBF\u540E\u53EF\u91CD\u8BD5\u3002" : currentState.status === "no-device" ? "\u5148\u4ECE\u5DE6\u4FA7\u8BBE\u5907\u5217\u8868\u9009\u62E9\u76EE\u6807\u8BBE\u5907\u3002" : currentState.status === "error" ? currentState.message : "";
    return h(
      "div",
      { className: "tether-native-surface", style: nativeSurfaceContainerStyle(visible) },
      currentState.status === "ready" && currentState.deviceId === deviceId && online ? h("iframe", {
        key: deviceId,
        src: currentState.url,
        title: "\u76EE\u6807\u8BBE\u5907\u7684 DSH \u539F\u751F\u5DE5\u4F5C\u533A",
        referrerPolicy: "no-referrer",
        style: { flex: "1 1 auto", width: "100%", height: "100%", minWidth: 0, minHeight: 0, border: 0, background: C2.bg }
      }) : h(
        "div",
        { style: { display: "grid", placeItems: "center", alignContent: "center", gap: 12, flex: "1 1 auto", minHeight: 0, color: C2.sub, textAlign: "center", padding: 24 } },
        h("div", null, message),
        currentState.status !== "loading" ? btn("\u91CD\u8BD5", () => setAttempt((value) => value + 1)) : null
      )
    );
  }
  function isSafeNativeSurfaceUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch (_) {
      return false;
    }
    const host2 = url.hostname.toLowerCase();
    const loopback = host2 === "127.0.0.1" || host2 === "[::1]";
    const publicSurface = url.protocol === "https:" && /^g\d{2,5}\.[a-z0-9.-]+$/.test(host2);
    const allowedHost = url.protocol === "http:" && loopback || publicSurface;
    return allowedHost && !url.username && !url.password && Number(url.port || (url.protocol === "https:" ? 443 : 80)) > 0 && url.pathname === "/tether-connect" && !!url.searchParams.get("ticket") && !url.hash;
  }
  function App() {
    const [state, setState] = React2.useState(null);
    const stateRef = React2.useRef(null);
    stateRef.current = state;
    const [deviceId, setDeviceId] = React2.useState("");
    const deviceIdRef = React2.useRef("");
    const treeDeviceEpochRef = React2.useRef(0);
    const loadedDirRef = React2.useRef("");
    const treeDeviceRef = React2.useRef("");
    if (treeDeviceRef.current !== deviceId) {
      treeDeviceRef.current = deviceId;
      treeDeviceEpochRef.current += 1;
    }
    deviceIdRef.current = deviceId;
    const [projects, setProjects] = React2.useState(null);
    const [project, setProject] = React2.useState(null);
    const [view, setView] = React2.useState("chat");
    const [activePanel, setActivePanel] = usePersisted("tether.ui.panel.v2", "workspaces");
    const [sidebarCollapsed, setSidebarCollapsed] = usePersisted("tether.ui.panelCollapsed", false);
    const [sidebarWidth, setSidebarWidth] = usePersisted("tether.ui.panelWidth.v2", UI.defaultSide);
    const [resizing, setResizing] = React2.useState(false);
    const [networkListWidth, setNetworkListWidth] = usePersisted("tether.ui.network.width", 300);
    const [networkResizing, setNetworkResizing] = React2.useState(false);
    const [networkPage, setNetworkPage] = React2.useState(1);
    const [networkRefreshing, setNetworkRefreshing] = React2.useState(false);
    const [notice, setNotice] = React2.useState("");
    const [busy, setBusy] = React2.useState(false);
    const [native, setNative] = React2.useState([]);
    const [nativeError, setNativeError] = React2.useState("");
    const [nativeLoaded, setNativeLoaded] = React2.useState(false);
    const [sessionId, setSessionId] = React2.useState("");
    const [sessionData, setSessionData] = React2.useState(null);
    const [sessionLoading, setSessionLoading] = React2.useState(false);
    const [runId, setRunId] = React2.useState("");
    const [runEvents, setRunEvents] = React2.useState([]);
    const [task, setTask] = React2.useState("");
    const [showSettings, setShowSettings] = React2.useState(false);
    const [policy, setPolicy] = React2.useState(null);
    const [audit, setAudit] = React2.useState([]);
    const [auditCount, setAuditCount] = React2.useState(0);
    const [auditRetained, setAuditRetained] = React2.useState(1e5);
    const [auditLoading, setAuditLoading] = React2.useState(false);
    const [mode, setMode] = React2.useState("readonly");
    const [rootsText, setRootsText] = React2.useState("");
    const [ask, setAsk] = React2.useState(null);
    const [path, setPath] = React2.useState("");
    const [pathDraft, setPathDraft] = React2.useState("");
    const [selected, setSelected] = React2.useState(null);
    const [file, setFile] = React2.useState(null);
    const [draft, setDraft] = React2.useState("");
    const [dirty, setDirty] = React2.useState(false);
    const [dirEntries, setDirEntries] = React2.useState([]);
    const [dirLoading, setDirLoading] = React2.useState(false);
    const [dirError, setDirError] = React2.useState("");
    const [history, setHistory] = React2.useState([]);
    const [contextMenu, setContextMenu] = React2.useState(null);
    const [deviceMenu, setDeviceMenu] = React2.useState(null);
    const [previewBusy, setPreviewBusy] = React2.useState(false);
    const [editMode, setEditMode] = React2.useState(false);
    const [workspaceOpen, setWorkspaceOpen] = React2.useState({});
    const [treeChildren, setTreeChildren] = React2.useState({});
    const [treeOpen, setTreeOpen] = React2.useState({});
    const [treeSelected, setTreeSelected] = React2.useState("");
    const [drives, setDrives] = React2.useState([]);
    const [freshSession, setFreshSession] = React2.useState(false);
    const fail2 = (e) => {
      if (e && e.code === "node_update_required") {
        setNativeError("\u8282\u70B9\u5F85\u66F4\u65B0");
        return;
      }
      setNotice(String(e && e.message || e));
    };
    React2.useEffect(() => {
      if (!notice) return;
      const t = setTimeout(() => setNotice(""), 7e3);
      return () => clearTimeout(t);
    }, [notice]);
    const loadState = React2.useCallback(async () => {
      try {
        const data = await api("/api/state");
        setState(data);
        setDeviceId((current) => {
          if (current && data.devices.some((d) => d.device_id === current)) return current;
          const local = data.local_device;
          if (local && data.devices.some((d) => d.device_id === local)) return local;
          const online = data.devices.find((d) => d.online);
          return online && online.device_id || ((data.devices[0] || {}).device_id || "");
        });
      } catch (e) {
        fail2(e);
      }
    }, []);
    React2.useEffect(() => {
      loadState();
      const t = setInterval(loadState, 2500);
      return () => clearInterval(t);
    }, [loadState]);
    const device = state && state.devices.find((d) => d.device_id === deviceId);
    const deviceOnline = !!(device && device.online);
    const safeSidebarWidth = clamp(sidebarWidth, UI.minSide, UI.maxSide);
    const previewUrl = React2.useMemo(() => {
      if (!file || !file.base64) return "";
      try {
        const bytes = Uint8Array.from(atob(file.base64), (char) => char.charCodeAt(0));
        return URL.createObjectURL(new Blob([bytes], { type: file.mime || "application/octet-stream" }));
      } catch (_) {
        return "";
      }
    }, [file && file.path, file && file.base64, file && file.mime]);
    React2.useEffect(() => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    }, [previewUrl]);
    React2.useEffect(() => {
      if (!deviceId) {
        setPolicy(null);
        return;
      }
      api("/api/devices/" + encodeURIComponent(deviceId) + "/policy").then(setPolicy).catch(() => setPolicy(null));
    }, [deviceId]);
    const loadProjects = React2.useCallback(async () => {
      if (!deviceId) return;
      const requestDevice = deviceId;
      const requestEpoch = treeDeviceEpochRef.current;
      const stillCurrent = () => treeResponseIsCurrent(requestDevice, deviceIdRef.current, requestEpoch, treeDeviceEpochRef.current);
      try {
        const data = await api("/api/devices/" + encodeURIComponent(requestDevice) + "/workspaces");
        if (!stillCurrent()) return;
        setProjects(data);
        setProject((current) => {
          if (current && data.workspaces.some((w) => w.path === current.path)) return current;
          return data.workspaces[0] || null;
        });
      } catch (e) {
        if (!stillCurrent()) return;
        const dev = (stateRef.current && stateRef.current.devices || []).find((d) => d.device_id === requestDevice);
        const fallback = dev && dev.capabilities && dev.capabilities.workspace;
        if (fallback) {
          const synthetic = { name: "Tether \u5DE5\u4F5C\u76EE\u5F55", path: fallback, kind: "node", writable: true, synthetic: true };
          setProjects({ root: fallback, node_workspace: fallback, workspaces: [synthetic], synthetic: true });
          setProject((current) => current && samePath(current.path, fallback) ? current : synthetic);
          setNativeError("\u8282\u70B9\u672A\u5347\u7EA7\uFF0C\u539F\u751F\u4F1A\u8BDD\u4E0D\u53EF\u7528");
        } else {
          setProjects(null);
          fail2(e);
        }
      }
    }, [deviceId]);
    React2.useEffect(() => {
      setProject(null);
      setPath("");
      setPathDraft("");
      setFile(null);
      setSelected(null);
      setSessionId("");
      setSessionData(null);
      setRunId("");
      setNativeLoaded(false);
      setWorkspaceOpen({});
      setTreeChildren({});
      setTreeOpen({});
      setTreeSelected("");
      setDrives([]);
      setDirEntries([]);
      setDirLoading(false);
      setDirError("");
      setHistory([]);
      setContextMenu(null);
      setPreviewBusy(false);
      setEditMode(false);
      loadedDirRef.current = "";
      loadProjects();
    }, [deviceId, loadProjects]);
    const loadNative = React2.useCallback(async () => {
      if (!deviceId) return;
      const requestDevice = deviceId;
      const requestEpoch = treeDeviceEpochRef.current;
      const stillCurrent = () => treeResponseIsCurrent(requestDevice, deviceIdRef.current, requestEpoch, treeDeviceEpochRef.current);
      try {
        const data = await api("/api/devices/" + encodeURIComponent(requestDevice) + "/dsh/sessions");
        if (!stillCurrent()) return;
        setNative(data.sessions || []);
        setNativeError("");
        setNativeLoaded(true);
      } catch (e) {
        if (!stillCurrent()) return;
        setNative([]);
        setNativeError(String(e.message || e));
        setNativeLoaded(true);
      }
    }, [deviceId]);
    React2.useEffect(() => {
      loadNative();
      const t = setInterval(loadNative, 8e3);
      return () => clearInterval(t);
    }, [loadNative]);
    React2.useEffect(() => {
      if (!deviceId) {
        setDrives([]);
        return;
      }
      let live = true;
      api("/api/devices/" + encodeURIComponent(deviceId) + "/drives").then((data) => {
        if (live) setDrives(data.drives || []);
      }).catch(() => {
        if (live) setDrives([]);
      });
      return () => {
        live = false;
      };
    }, [deviceId]);
    const lastProject = React2.useRef("");
    React2.useEffect(() => {
      const currentPath = project ? project.path : "";
      if (currentPath === lastProject.current) return;
      lastProject.current = currentPath;
      setSessionId("");
      setRunId("");
      if (view !== "files") {
        setPath(currentPath);
        setPathDraft(currentPath);
        setFile(null);
      }
    }, [project, view]);
    const nativeKey = native.map((s) => s.session_id).sort().join(",");
    const sessions = state && state.sessions || [];
    const workspaceOf = (run) => {
      const s = sessions.find((x) => x.session_id === run.session_id);
      return s ? s.workspace : "";
    };
    const runs = (state && state.runs || []).filter((r) => !deviceId || r.device_id === deviceId).slice(0, 80);
    const currentRun = runs.find((r) => r.run_id === runId);
    const nativeIds = new Set(native.map((s) => s.session_id));
    const nativeItems = native.map((s) => ({
      type: "native",
      key: "session:" + s.session_id,
      session_id: s.session_id,
      title: s.title || s.session_id,
      status: s.status,
      updated_at: s.updated_at,
      workspace: s.cwd,
      cwd: s.cwd,
      source: s.session_id.startsWith("tether-") ? "Tether" : "DSH"
    }));
    const virtualRuns = runs.filter((r) => {
      const expected = "tether-" + r.session_id;
      const ds = (r.outcome || {}).dsh_session;
      const fresh = r.created_at && Date.now() / 1e3 - r.created_at < 900;
      return !nativeIds.has(expected) && !(ds && nativeIds.has(ds)) && (["queued", "dispatching", "running", "cancelling"].includes(r.state) || fresh);
    }).map((r) => ({
      type: "run",
      key: "run:" + r.run_id,
      run_id: r.run_id,
      title: shortText(r.prompt, 54),
      state: r.state,
      updated_at: r.created_at,
      workspace: workspaceOf(r),
      source: "Tether"
    }));
    const freshItem = freshSession && project ? {
      type: "fresh",
      key: "fresh",
      title: "\u65B0\u4F1A\u8BDD",
      state: "queued",
      updated_at: Date.now() / 1e3,
      workspace: project.path,
      source: "Tether"
    } : null;
    const allSessions = [...nativeItems, ...virtualRuns, ...freshItem ? [freshItem] : []].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    const projectPaths = (projects && projects.workspaces || []).filter((w) => w.kind !== "node").map((w) => w.path);
    const workspaceNodes = (projects && projects.workspaces || []).filter((w) => w.kind !== "node").map((w) => ({
      ...w,
      name: w.name === "default-workspace" ? "\u9ED8\u8BA4\u5DE5\u4F5C\u533A" : w.name,
      source: w.kind === "dsh" && !(projects && projects.root && normPath(w.path).startsWith(normPath(projects.root))) ? "DSH" : "Tether",
      sessions: allSessions.filter((s) => samePath(s.workspace, w.path))
    }));
    const ungrouped = allSessions.filter((s) => !projectPaths.some((p) => samePath(s.workspace, p)));
    const ungroupedPaths = Array.from(new Map(ungrouped.filter((s) => s.workspace && !projectPaths.some((p) => samePath(s.workspace, p))).map((s) => [normPath(s.workspace), s.workspace])).values());
    const workspaceKey = workspaceNodes.map((w) => w.path + ":" + w.sessions.map((s) => s.key).join("|")).join(";");
    React2.useEffect(() => {
      if (!sessionId || !deviceId) {
        setSessionData(null);
        setSessionLoading(false);
        return;
      }
      let live = true;
      const load = async () => {
        setSessionLoading(true);
        try {
          const data = await api("/api/devices/" + encodeURIComponent(deviceId) + "/dsh/sessions/" + encodeURIComponent(sessionId));
          if (live) {
            setSessionData(data);
            setSessionLoading(false);
          }
        } catch (e) {
          if (live) {
            setSessionLoading(false);
            fail2(e);
          }
        }
      };
      load();
      const t = setInterval(load, 1500);
      return () => {
        live = false;
        clearInterval(t);
      };
    }, [sessionId, deviceId]);
    React2.useEffect(() => {
      if (!project) {
        setSessionId("");
        setRunId("");
        return;
      }
      if (freshSession) return;
      if (sessionId || runId) return;
      const node = workspaceNodes.find((w) => w.path === project.path);
      if (!node) return;
      const hasSession = sessionId && node.sessions.some((s) => s.type === "native" && s.session_id === sessionId);
      const hasRun = runId && node.sessions.some((s) => s.type === "run" && s.run_id === runId);
      if (hasSession || hasRun) return;
      const first = node.sessions.find((s) => s.type !== "fresh");
      if (first) {
        if (first.type === "native") {
          setSessionId(first.session_id);
          setRunId("");
        } else {
          setRunId(first.run_id);
          setSessionId("");
        }
      }
    }, [project, workspaceKey, sessionId, runId, freshSession]);
    React2.useEffect(() => {
      if (!sessionId || !nativeLoaded) return;
      if (!native.some((s) => s.session_id === sessionId)) {
        setSessionId("");
        setSessionData(null);
        setSessionLoading(false);
      }
    }, [nativeKey, nativeLoaded, sessionId]);
    React2.useEffect(() => {
      if (!runId) return;
      const run = runs.find((r) => r.run_id === runId);
      if (!run) return;
      const expected = "tether-" + run.session_id;
      const target = native.find((s) => s.session_id === expected) || ((run.outcome || {}).dsh_session ? native.find((s) => s.session_id === run.outcome.dsh_session) : null);
      if (target) {
        setSessionId(target.session_id);
        setRunId("");
      }
    }, [nativeKey, runId]);
    React2.useEffect(() => {
      if (!runId) {
        setRunEvents([]);
        return;
      }
      let live = true;
      const load = async () => {
        try {
          const data = await api("/api/runs/" + encodeURIComponent(runId) + "/events?after_seq=0");
          if (live) setRunEvents(data.events || []);
        } catch (_) {
        }
      };
      load();
      const t = setInterval(load, 1e3);
      return () => {
        live = false;
        clearInterval(t);
      };
    }, [runId]);
    const runConversation = (run, events) => {
      const blocks = [];
      let state2 = run ? run.state : "queued";
      let call = null;
      for (const ev of events) {
        const p = ev.payload || {};
        if (ev.kind === "thought") blocks.push({ type: "reasoning", text: String(p.text || "") });
        else if (ev.kind === "assistant") blocks.push({ type: "text", text: String(p.text || "") });
        else if (ev.kind === "tool" && p.type === "tool/call") {
          let parsed = {};
          try {
            parsed = JSON.parse(p.data || "{}");
          } catch (_) {
          }
          const args = parsed.arguments || "";
          let command = "";
          try {
            const a = JSON.parse(args);
            command = a.command || a.file_path || a.path || "";
          } catch (_) {
            command = String(args || "");
          }
          call = { type: "tool", id: parsed.callId || "", name: parsed.name || p.name || "tool", arguments: String(args || ""), command: String(command || ""), result: "", status: "running" };
          blocks.push(call);
        } else if (ev.kind === "tool" && p.type === "tool/result") {
          let data = {};
          try {
            data = JSON.parse(p.data || "{}");
          } catch (_) {
          }
          const message = data.message || {};
          const id = message.toolCallId || data.toolCallId || "";
          const target = id && blocks.find((b) => b.type === "tool" && b.id === id) || call;
          if (target) {
            target.result = String(p.text || "");
            target.is_error = !!message.isError;
            target.status = target.is_error ? "error" : "done";
            call = null;
          }
        } else if (ev.kind === "log" && p.type === "turn/end") {
          state2 = p.reason === "completed" ? "completed" : p.reason === "cancelled" ? "cancelled" : p.reason === "error" ? "failed" : state2;
        }
      }
      if (!blocks.length && run && run.final_response) blocks.push({ type: "text", text: run.final_response });
      const turnState = !run ? "running" : run.state === "completed" ? "completed" : run.state === "failed" ? "failed" : run.state === "cancelled" ? "cancelled" : "running";
      return {
        title: run ? shortText(run.prompt, 50) : "",
        status: state2,
        turns: run ? [{
          turn: 1,
          user: { text: run.prompt },
          blocks,
          state: turnState,
          started_at: run.started_at || run.created_at || null,
          ended_at: run.finished_at || null,
          steps: 0,
          usage: {}
        }] : []
      };
    };
    const currentWorkspace = workspaceNodes.find((w) => w.path === (project && project.path));
    const currentSessions = currentWorkspace ? currentWorkspace.sessions : [];
    const conversation = sessionId ? sessionData : currentRun ? runConversation(currentRun, runEvents) : null;
    const conversationTitle = sessionId ? sessionData && sessionData.title || (native.find((s) => s.session_id === sessionId) || {}).title || "DSH \u4F1A\u8BDD" : currentRun ? shortText(currentRun.prompt, 50) : freshSession ? "\u65B0\u4F1A\u8BDD" : "";
    const conversationStatus = sessionId ? sessionData && sessionData.status || "idle" : currentRun ? currentRun.state : "idle";
    const sendTarget = freshSession ? null : resolveSessionTarget(sessionId, currentRun, native, sessions, runs, deviceId, project && project.path, currentRun && workspaceOf(currentRun));
    const historicalSessionReadOnly = !!(sessionId && sendTarget && sendTarget.blocked);
    const invalidRunTarget = !!(runId && !freshSession && (!currentRun || sendTarget && sendTarget.blocked));
    const sendTargetBlocked = historicalSessionReadOnly || invalidRunTarget;
    const startTask = async () => {
      if (!task.trim() || !deviceId || !project) return;
      if (!freshSession && (sendTargetBlocked || (sessionId || currentRun) && !sendTarget)) {
        setNotice("\u5F53\u524D\u5386\u53F2\u4F1A\u8BDD\u6CA1\u6709\u53EF\u7EE7\u7EED\u7684\u76EE\u6807\uFF0C\u8BF7\u5728\u6B64\u5DE5\u4F5C\u533A\u65B0\u5EFA\u4F1A\u8BDD\u3002");
        return;
      }
      setBusy(true);
      try {
        let sid = !freshSession && sendTarget ? sendTarget.sessionId : "";
        if (!sid) {
          const created = await post("/api/sessions", { device_id: deviceId, workspace: project.path });
          if (!isNewSessionId(created.session_id, sessions)) throw new Error("\u65B0\u4F1A\u8BDD\u672A\u751F\u6210\u65B0\u7684\u4F1A\u8BDD ID\uFF0C\u8BF7\u91CD\u8BD5\u3002");
          sid = created.session_id;
        }
        setFreshSession(false);
        const run = await post("/api/sessions/" + encodeURIComponent(sid) + "/runs", {
          request_id: "ui-" + Date.now() + "-" + Math.random().toString(16).slice(2),
          prompt: task.trim()
        });
        setTask("");
        setSessionId("");
        setSessionData(null);
        setRunId(run.run_id);
        setView("chat");
        loadState();
        setTimeout(loadNative, 1200);
        setTimeout(loadNative, 4e3);
      } catch (e) {
        fail2(e);
      } finally {
        setBusy(false);
      }
    };
    const send = () => {
      if (task.trim() && deviceOnline) startTask();
    };
    const openSettings = async () => {
      setShowSettings(true);
      try {
        const p = await api("/api/devices/" + encodeURIComponent(deviceId) + "/policy");
        setPolicy(p);
        setMode(p.mode);
        setRootsText((p.allowed_roots || []).join("\n"));
        const a = await api("/api/devices/" + encodeURIComponent(deviceId) + "/audit?limit=200");
        setAudit(a.entries || []);
        setAuditCount(a.count || 0);
        setAuditRetained(a.retained || 1e5);
      } catch (e) {
        fail2(e);
      }
    };
    const rootList = () => rootsText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const editRoot = (index) => {
      const list = rootList();
      askValue("\u7F16\u8F91\u53EF\u5199\u6839\u76EE\u5F55", list[index] || "", (value) => {
        const next = [...list];
        next[index] = value;
        setRootsText(next.join("\n"));
      });
    };
    const addRoot = () => askValue("\u6DFB\u52A0\u53EF\u5199\u6839\u76EE\u5F55", "", (value) => {
      const list = rootList();
      if (!list.some((item) => normPath(item) === normPath(value))) setRootsText([...list, value].join("\n"));
    });
    const removeRoot = (index) => {
      const list = rootList();
      setRootsText(list.filter((_, itemIndex) => itemIndex !== index).join("\n"));
    };
    const savePolicy = async () => {
      if (mode === "full" && !window.confirm("Full-disk mode lets this Tether plugin write and delete files anywhere the node user can, except protected system directories and credential stores.\n\nEnable it?")) return;
      setBusy(true);
      try {
        const roots = rootList();
        const p = await post("/api/devices/" + encodeURIComponent(deviceId) + "/policy", { mode, allowed_roots: roots });
        setPolicy(p);
        setNotice("Policy updated: " + p.mode);
        const a = await api("/api/devices/" + encodeURIComponent(deviceId) + "/audit?limit=200");
        setAudit(a.entries || []);
        setAuditCount(a.count || 0);
        setAuditRetained(a.retained || 1e5);
      } catch (e) {
        fail2(e);
      } finally {
        setBusy(false);
      }
    };
    const loadMoreAudit = async () => {
      if (auditLoading) return;
      setAuditLoading(true);
      try {
        const a = await api("/api/devices/" + encodeURIComponent(deviceId) + "/audit?limit=200&offset=" + audit.length);
        setAudit((current) => [...current, ...a.entries || []]);
        setAuditCount(a.count || 0);
        setAuditRetained(a.retained || 1e5);
      } catch (e) {
        fail2(e);
      } finally {
        setAuditLoading(false);
      }
    };
    const fsPath = (op) => "/api/devices/" + encodeURIComponent(deviceId) + "/fs/" + op;
    const parentOf = (target) => {
      const clean = String(target || "").replace(/[\\/]+$/, "");
      const parent = clean.replace(/[\\/][^\\/]+$/, "");
      return parent && parent !== clean ? parent : clean;
    };
    const pathInfo = (target) => {
      const norm = normPath(target);
      if (!norm) return null;
      const workspace = workspaceNodes.find((w) => norm === normPath(w.path) || norm.startsWith(normPath(w.path) + "/"));
      if (workspace) return { groupId: "workspaces", workspaceId: workspace.id, root: workspace.path };
      const stray = ungroupedPaths.find((p) => norm === normPath(p) || norm.startsWith(normPath(p) + "/"));
      if (stray) return { groupId: "ungrouped", workspaceId: "", root: stray };
      const drive = drives.find((d) => norm === normPath(d.path) || norm.startsWith(normPath(d.path) + "/"));
      return drive ? { groupId: "drives", workspaceId: "", root: drive.path } : null;
    };
    const treeNodeFor = (target, info) => ({
      id: treeNodeId(deviceId, info.groupId, info.workspaceId, target),
      cacheKey: treeCacheKey(deviceId, target),
      deviceId,
      groupId: info.groupId,
      workspaceId: info.workspaceId,
      name: pathBasename(target),
      path: target,
      dir: true
    });
    const loadTreeDir = async (target, node) => {
      const requestDevice = deviceId;
      if (!requestDevice || !target) return;
      const requestEpoch = treeDeviceEpochRef.current;
      const key = node ? node.cacheKey : treeCacheKey(requestDevice, target);
      setTreeChildren((current) => ({ ...current, [key]: { status: "loading", entries: [] } }));
      try {
        const data = await post("/api/devices/" + encodeURIComponent(requestDevice) + "/fs/list", { path: target });
        if (!treeResponseIsCurrent(requestDevice, deviceIdRef.current, requestEpoch, treeDeviceEpochRef.current)) return;
        const entries = (data.entries || []).map((entry) => ({ ...entry, path: joinPath(target, entry.name) })).filter((entry, index, all) => all.findIndex((item) => normPath(item.path) === normPath(entry.path)) === index);
        setTreeChildren((current) => ({ ...current, [key]: { status: "loaded", entries } }));
      } catch (e) {
        if (!treeResponseIsCurrent(requestDevice, deviceIdRef.current, requestEpoch, treeDeviceEpochRef.current)) return;
        setTreeChildren((current) => ({ ...current, [key]: { status: "error", entries: [] } }));
      }
    };
    const revealTree = (target) => {
      const info = pathInfo(target);
      if (!info) return;
      const normTarget = normPath(target);
      const normRoot = normPath(info.root);
      const paths = [info.root];
      if (normTarget !== normRoot && normTarget.startsWith(normRoot + "/")) {
        let cursor = String(info.root).replace(/[\\/]+$/, "");
        const relative = String(target).slice(String(info.root).length).replace(/^[\\/]+/, "");
        for (const part of relative.split(/[\\/]+/)) {
          if (!part) continue;
          cursor += "\\" + part;
          paths.push(cursor);
        }
      }
      const open = {};
      paths.forEach((item) => {
        const node = treeNodeFor(item, info);
        open[node.id] = true;
        const cached = treeChildren[node.cacheKey];
        if (!cached || cached.status === "error") loadTreeDir(item, node);
      });
      setTreeOpen((current) => ({ ...current, ...open }));
      const selectedPath = target;
      setTreeSelected(treeNodeId(deviceId, info.groupId, info.workspaceId, selectedPath));
    };
    const loadDir = async (target, options) => {
      const opts = options || {};
      if (!deviceId || !target) return;
      const requestDevice = deviceId;
      const rawTarget = String(target);
      const requestTarget = /^[A-Za-z]:[\\/]?$/.test(rawTarget) ? rawTarget.slice(0, 2) + "\\" : rawTarget;
      setDirLoading(true);
      setDirError("");
      try {
        const data = await post(fsPath("list"), { path: requestTarget });
        if (deviceIdRef.current !== requestDevice) return;
        const nextPath = /^[A-Za-z]:[\\/]?$/.test(rawTarget) ? requestTarget : rawTarget.replace(/[\\/]+$/, "") || rawTarget;
        const entries = (data.entries || []).map((entry) => ({ ...entry, path: joinPath(requestTarget, entry.name) }));
        if (opts.push !== false && path && path !== nextPath) setHistory((current) => [...current, path]);
        setDirEntries(entries);
        setPath(nextPath);
        setPathDraft(nextPath);
        loadedDirRef.current = requestDevice + "|" + normPath(nextPath);
        setSelected(null);
        if (!opts.keepFile) {
          setFile(null);
          setEditMode(false);
          setDirty(false);
          setDraft("");
        }
        revealTree(nextPath);
      } catch (e) {
        if (deviceIdRef.current !== requestDevice) return;
        setDirError(String(e.message || e));
        setDirEntries([]);
      } finally {
        setDirLoading(false);
      }
    };
    const openPreview = async (entry) => {
      if (!entry || entry.dir) return;
      setPreviewBusy(true);
      setDirError("");
      try {
        const data = await post(fsPath("preview"), { path: entry.path });
        const parent = parentOf(entry.path);
        setFile({ ...data, path: entry.path, name: entry.name || pathBasename(entry.path) });
        setDraft(data.text || "");
        setDirty(false);
        setEditMode(false);
        setSelected(entry);
        setPath(parent);
        setPathDraft(parent);
        setView("files");
        await loadDir(parent, { push: false, keepFile: true });
        setSelected(entry);
      } catch (e) {
        fail2(e);
      } finally {
        setPreviewBusy(false);
      }
    };
    const openFile = async (entry) => {
      if (!entry) return;
      if (entry.dir) {
        setSelected(entry);
        setTreeOpen((current) => ({ ...current, [entry.id]: true }));
        await loadDir(entry.path, { push: true });
        return;
      }
      await openPreview(entry);
    };
    const toggleTree = (node, retry) => {
      if (!node.dir) {
        openPreview(node);
        return;
      }
      const target = node.path;
      const next = retry || !treeOpen[node.id];
      setTreeSelected(node.id);
      setTreeOpen((current) => ({ ...current, [node.id]: next }));
      if (next) {
        loadDir(target, { push: true });
        const cached = treeChildren[node.cacheKey];
        if (retry || !cached || cached.status === "error") loadTreeDir(target, node);
      } else {
        setPath(target);
        setPathDraft(target);
      }
    };
    const goBack = () => {
      if (!history.length) return;
      const previous = history[history.length - 1];
      setHistory((current) => current.slice(0, -1));
      loadDir(previous, { push: false });
    };
    const refreshExplorer = () => {
      if (file) openPreview(file);
      else if (path) loadDir(path, { push: false, keepFile: true });
    };
    const openContextMenu = (event, entry, base) => {
      event.preventDefault();
      event.stopPropagation();
      if (entry) setSelected(entry);
      setContextMenu({ x: event.clientX, y: event.clientY, entry: entry || null, base: base || path });
    };
    const saveFile = async () => {
      if (!file || file.kind === "image" || file.kind === "pdf" || file.kind === "unsupported") return;
      setBusy(true);
      try {
        await post(fsPath("write"), { path: file.path, text: draft });
        setDirty(false);
        setNotice("Saved " + file.path);
        const data = await post(fsPath("preview"), { path: file.path });
        setFile({ ...data, path: file.path, name: file.name });
        setDraft(data.text || "");
        setEditMode(false);
        if (path) loadDir(path, { push: false, keepFile: true });
      } catch (e) {
        fail2(e);
      } finally {
        setBusy(false);
      }
    };
    const askValue = (title, value, onOk) => setAsk({ title, value: value || "", onOk });
    const makeFolder = (base) => askValue("\u65B0\u5EFA\u6587\u4EF6\u5939", "", async (name) => {
      try {
        await post(fsPath("mkdir"), { path: String(base).replace(/[\\/]+$/, "") + "\\" + name });
        setContextMenu(null);
        await loadDir(base, { push: false, keepFile: true });
        const info = pathInfo(base);
        if (info) loadTreeDir(base, treeNodeFor(base, info));
      } catch (e) {
        fail2(e);
      }
    });
    const makeFile = (base) => askValue("\u65B0\u5EFA\u6587\u4EF6", "", async (name) => {
      const target = String(base).replace(/[\\/]+$/, "") + "\\" + name;
      try {
        await post(fsPath("write"), { path: target, text: "" });
        setContextMenu(null);
        await loadDir(base, { push: false, keepFile: true });
        openPreview({ path: target, dir: false, name });
      } catch (e) {
        fail2(e);
      }
    });
    const renameEntry = (entry) => {
      const target = entry || selected;
      if (!target) return;
      askValue("\u91CD\u547D\u540D", target.name, async (name) => {
        try {
          await post(fsPath("rename"), { path: target.path, dest: parentOf(target.path) + "\\" + name });
          setContextMenu(null);
          setSelected(null);
          if (file && file.path === target.path) setFile(null);
          await loadDir(path, { push: false, keepFile: true });
        } catch (e) {
          fail2(e);
        }
      });
    };
    const deleteEntry = async (entry) => {
      const target = entry || selected;
      if (!target) return;
      if (!window.confirm('Move "' + target.name + '" to .tether-trash?')) return;
      try {
        await post(fsPath("delete"), { path: target.path });
        setContextMenu(null);
        setSelected(null);
        if (file && file.path === target.path) setFile(null);
        await loadDir(path, { push: false, keepFile: true });
      } catch (e) {
        fail2(e);
      }
    };
    const newProject = () => {
      if (!projects) return;
      askValue("\u65B0\u5EFA\u5DE5\u4F5C\u533A\uFF08" + projects.root + "\uFF09", "", async (name) => {
        try {
          const target = projects.root + "\\" + name;
          await post("/api/devices/" + encodeURIComponent(deviceId) + "/fs/mkdir", { path: target });
          await post("/api/devices/" + encodeURIComponent(deviceId) + "/dsh/workspaces/register", { path: target, title: name }).catch(() => {
          });
          await loadProjects();
          setProject({ name, path: target, kind: "tether", source: "Tether" });
          setWorkspaceOpen((current) => ({ ...current, [target]: true }));
          setFreshSession(true);
          setSessionId("");
          setRunId("");
          setView("chat");
        } catch (e) {
          fail2(e);
        }
      });
    };
    const newSessionFor = (workspace) => {
      setProject(workspace);
      setWorkspaceOpen((current) => ({ ...current, [workspace.path]: true }));
      setFreshSession(true);
      setSessionId("");
      setRunId("");
      setTask("");
      setView("chat");
    };
    const applyWorkspaceSelection = (workspace, selection) => {
      const next = selectWorkspaceState(lastProject, { projectPath: project ? project.path : "", sessionId, runId, path, pathDraft, file }, workspace, selection);
      setProject(workspace);
      setPath(next.path);
      setPathDraft(next.path);
      setFile(next.file);
      setSessionId(next.sessionId);
      setRunId(next.runId);
    };
    const submitAsk = () => {
      if (!ask) return;
      const value = ask.value.trim();
      if (!value) return;
      const cb = ask.onOk;
      setAsk(null);
      cb(value);
    };
    const selectPanel = (id) => {
      if (id === "workspaces") {
        setView("chat");
        setActivePanel("workspaces");
        setSidebarCollapsed(true);
        return;
      }
      if (id === "network") {
        setView("network");
        setActivePanel("network");
        setSidebarCollapsed(true);
        return;
      }
      if (id === "files") {
        if (view === "files" && activePanel === "files" && !sidebarCollapsed) {
          setSidebarCollapsed(true);
          return;
        }
        const info = path ? pathInfo(path) : null;
        if (workspaceNodes[0] && view !== "files" && (!info || info.groupId === "ungrouped")) {
          setPath(workspaceNodes[0].path);
          setPathDraft(workspaceNodes[0].path);
          setFile(null);
          setSelected(null);
          loadedDirRef.current = "";
        }
        setView("files");
        setActivePanel("files");
        setSidebarCollapsed(false);
      }
    };
    const dragWidth = (event, start, setter, min, max) => {
      event.preventDefault();
      setResizing(true);
      const startX = event.clientX;
      const move = (ev) => setter(clamp(start + ev.clientX - startX, min, max));
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setResizing(false);
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    };
    const startSidebarResize = (event) => dragWidth(event, safeSidebarWidth, setSidebarWidth, UI.minSide, UI.maxSide);
    const startNetworkResize = (event) => {
      event.preventDefault();
      setNetworkResizing(true);
      const startX = event.clientX;
      const startWidth = networkListWidth;
      const move = (ev) => setNetworkListWidth(clamp(startWidth + ev.clientX - startX, 220, 520));
      const stop = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        document.body.style.cursor = "";
        setNetworkResizing(false);
      };
      document.body.style.cursor = "col-resize";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    };
    const refreshNetwork = async () => {
      if (networkRefreshing) return;
      setNetworkRefreshing(true);
      try {
        await loadState();
      } finally {
        setTimeout(() => setNetworkRefreshing(false), 280);
      }
    };
    React2.useEffect(() => {
      if (!contextMenu) return void 0;
      const close = () => setContextMenu(null);
      const onKey = (event) => {
        if (event.key === "Escape") close();
      };
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", onKey);
      return () => {
        window.removeEventListener("pointerdown", close);
        window.removeEventListener("keydown", onKey);
      };
    }, [contextMenu]);
    React2.useEffect(() => {
      if (!deviceMenu) return void 0;
      const close = () => setDeviceMenu(null);
      const onKey = (event) => {
        if (event.key === "Escape") close();
      };
      window.addEventListener("pointerdown", close);
      window.addEventListener("keydown", onKey);
      return () => {
        window.removeEventListener("pointerdown", close);
        window.removeEventListener("keydown", onKey);
      };
    }, [deviceMenu]);
    React2.useEffect(() => {
      if (!showSettings) return void 0;
      const onKey = (event) => {
        if (event.key === "Escape") setShowSettings(false);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [showSettings]);
    React2.useEffect(() => {
      if (view !== "files" || !deviceId || !projects || projects.synthetic) return;
      const firstWorkspace = workspaceNodes[0] && workspaceNodes[0].path;
      const target = (loadedDirRef.current ? path || firstWorkspace : firstWorkspace || project && project.path || path) || "";
      if (!target) return;
      const key = deviceId + "|" + normPath(target);
      if (loadedDirRef.current === key) return;
      loadedDirRef.current = key;
      setPath(target);
      setPathDraft(target);
      loadDir(target, { push: false, keepFile: !!file });
    }, [view, deviceId, path, project, projects, workspaceKey]);
    const modelText = sessionId && sessionData ? [sessionData.model, sessionData.agent_preset].filter(Boolean).join(" \xB7 ") : "";
    const renderExplorer = () => {
      const iconButton = (name, label, onClick, disabled, spinning) => h("button", {
        title: label,
        "aria-label": label,
        onClick,
        disabled,
        className: "tether-hover tether-press",
        style: { width: 28, height: 28, display: "grid", placeItems: "center", border: 0, borderRadius: 6, background: "transparent", color: disabled ? C2.mute : C2.sub, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1, flex: "0 0 auto" }
      }, spinning ? h("span", { className: "tether-spin", style: { display: "grid", placeItems: "center" } }, h(Glyph, { name: "refresh", size: 16 })) : h(Glyph, { name, size: 16 }));
      const crumbs = pathSegments(file ? file.path : path);
      const toolbar = h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 2, height: 40, padding: "0 8px", background: C2.bg, flex: "0 0 auto", minWidth: 0 } },
        iconButton("back", "\u540E\u9000", goBack, !history.length),
        iconButton("arrowUp", "\u4E0A\u7EA7\u76EE\u5F55", () => {
          const parent = parentOf(file ? file.path : path);
          if (parent && parent !== path) {
            setFile(null);
            loadDir(parent, { push: true });
          }
        }, !path),
        iconButton("refresh", "\u5237\u65B0", refreshExplorer, !path, dirLoading || previewBusy),
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 1, minWidth: 0, overflow: "hidden", marginLeft: 6 } },
          crumbs.map((segment, index) => h(
            React2.Fragment,
            { key: segment.path },
            index ? h("span", { style: { color: C2.mute, fontSize: 10, flex: "0 0 auto" } }, "\u203A") : null,
            h("button", {
              title: segment.path,
              onClick: () => {
                setFile(null);
                loadDir(segment.path, { push: true });
              },
              className: "tether-hover",
              style: { border: 0, background: "transparent", borderRadius: 5, padding: "3px 5px", fontSize: 12, lineHeight: "18px", color: index === crumbs.length - 1 ? C2.ink : C2.sub, cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 190 }
            }, segment.label)
          ))
        ),
        selected && !file ? h("span", { style: { marginLeft: "auto", fontSize: 11, color: C2.mute, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 } }, selected.name) : null
      );
      const closePreview = () => {
        setFile(null);
        setEditMode(false);
        setDirty(false);
        setDraft("");
        if (path) loadDir(path, { push: false });
      };
      const fileHeader = file ? h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 8, height: 40, padding: "0 10px", background: C2.panel, flex: "0 0 auto", minWidth: 0 } },
        iconButton("back", "\u8FD4\u56DE\u6587\u4EF6\u5939", closePreview, false),
        h(Native.FileTypeIcon, { path: file.name || file.path, size: 16 }),
        h("span", { style: { fontSize: 13, fontWeight: "var(--tether-strong, 600)", color: C2.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, file.name || pathBasename(file.path)),
        file.writable ? null : pill("\u53EA\u8BFB", C2.amber),
        file.converted ? pill("\u5DF2\u8F6C PDF", C2.mute) : null,
        h(
          "span",
          { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 2 } },
          (file.kind === "markdown" || file.kind === "text") && file.writable ? iconButton("pencil", editMode ? "\u9884\u89C8" : "\u7F16\u8F91", () => setEditMode((value) => !value), false) : null,
          (file.kind === "markdown" || file.kind === "text") && file.writable ? iconButton("save", "\u4FDD\u5B58", saveFile, !dirty || busy) : null,
          h("span", { className: "tether-num", style: { fontSize: 10.5, color: C2.mute, marginLeft: 4 } }, formatBytes(file.size))
        )
      ) : null;
      const previewBody = () => {
        if (previewBusy) return h("div", { style: { flex: "1 1 auto", display: "grid", placeItems: "center", color: C2.mute, fontSize: 12 } }, h("span", { className: "tether-spin", style: { width: 18, height: 18, display: "grid", placeItems: "center" } }, h(Glyph, { name: "refresh", size: 18 })));
        if (!file) return null;
        if (file.kind === "markdown") {
          if (editMode) return h("textarea", { value: draft, onChange: (ev) => {
            setDraft(ev.target.value);
            setDirty(true);
          }, spellCheck: false, style: { flex: "1 1 auto", width: "100%", boxSizing: "border-box", resize: "none", border: 0, outline: "none", padding: "14px 18px", fontFamily: "Consolas, monospace", fontSize: 12.5, lineHeight: 1.6, background: C2.bg, color: C2.ink } });
          return h("div", { className: "tether-file-scroll", style: { flex: "1 1 auto", overflow: "auto", padding: "22px 28px 40px" } }, h("div", { className: "tether-file-markdown" }, h(Markdown, { text: draft || "", labels: nativeMarkdownLabels })));
        }
        if (file.kind === "text") {
          if (editMode) return h("textarea", { value: draft, onChange: (ev) => {
            setDraft(ev.target.value);
            setDirty(true);
          }, spellCheck: false, style: { flex: "1 1 auto", width: "100%", boxSizing: "border-box", resize: "none", border: 0, outline: "none", padding: "14px 18px", fontFamily: "Consolas, monospace", fontSize: 12.5, lineHeight: 1.6, background: C2.bg, color: C2.ink } });
          return h("pre", { className: "tether-file-text tether-scroll", style: { flex: "1 1 auto", overflow: "auto", margin: 0, padding: "16px 20px", fontFamily: "Consolas, monospace", fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", color: C2.ink, background: C2.bg } }, draft);
        }
        if (file.kind === "image") return h(
          "div",
          { style: { flex: "1 1 auto", overflow: "auto", display: "grid", placeItems: "center", padding: 18, background: C2.panel } },
          previewUrl ? h("img", { src: previewUrl, alt: file.name || "", style: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 6 } }) : h("span", { style: { color: C2.mute, fontSize: 12 } }, "\u56FE\u7247\u9884\u89C8\u5931\u8D25")
        );
        if (file.kind === "pdf") return previewUrl ? h("embed", { src: previewUrl, type: "application/pdf", style: { flex: "1 1 auto", width: "100%", height: "100%", minHeight: 0, border: 0, background: C2.panel } }) : h("div", { style: { flex: "1 1 auto", display: "grid", placeItems: "center", color: C2.mute, fontSize: 12 } }, "PDF \u9884\u89C8\u5931\u8D25");
        return h(
          "div",
          { style: { flex: "1 1 auto", display: "grid", placeItems: "center", alignContent: "center", gap: 6, color: C2.mute, fontSize: 12, padding: 24, textAlign: "center" } },
          h("div", null, "\u6B64\u7C7B\u578B\u6682\u4E0D\u652F\u6301\u9884\u89C8"),
          h("div", { className: "tether-num", style: { fontSize: 11 } }, (file.name || file.path) + " \xB7 " + formatBytes(file.size))
        );
      };
      const entries = [...dirEntries].sort((a, b) => a.dir === b.dir ? String(a.name || "").localeCompare(String(b.name || "")) : a.dir ? -1 : 1);
      const columns = "minmax(0,1fr) 132px 104px 78px";
      const directoryBody = () => {
        if (dirLoading && !entries.length) return h("div", { style: { flex: "1 1 auto", display: "grid", placeItems: "center", color: C2.mute, fontSize: 12 } }, "\u52A0\u8F7D\u4E2D\u2026");
        if (dirError) return h(
          "div",
          { style: { flex: "1 1 auto", display: "grid", placeItems: "center", alignContent: "center", gap: 8, color: C2.red, fontSize: 12, padding: 24, textAlign: "center" } },
          h("div", null, dirError),
          h("button", { onClick: refreshExplorer, className: "tether-hover", style: { border: 0, borderRadius: 6, padding: "5px 10px", background: C2.soft, color: C2.ink, fontSize: 12, cursor: "pointer" } }, "\u91CD\u8BD5")
        );
        if (!path) return h("div", { style: { flex: "1 1 auto", display: "grid", placeItems: "center", color: C2.mute, fontSize: 12 } }, "\u4ECE\u5DE6\u4FA7\u9009\u62E9\u5DE5\u4F5C\u533A\u6216\u78C1\u76D8");
        if (!entries.length) return h("div", { style: { flex: "1 1 auto", display: "grid", placeItems: "center", color: C2.mute, fontSize: 12 } }, "\u7A7A\u6587\u4EF6\u5939");
        return h(
          "div",
          { className: "tether-scroll", style: { flex: "1 1 auto", overflow: "auto", padding: "0 10px 24px" } },
          h(
            "div",
            { style: { display: "grid", gridTemplateColumns: columns, gap: 8, height: 28, padding: "0 8px", alignItems: "center", fontSize: 11, color: C2.mute } },
            h("span", null, "\u540D\u79F0"),
            h("span", null, "\u4FEE\u6539\u65E5\u671F"),
            h("span", null, "\u7C7B\u578B"),
            h("span", { style: { textAlign: "right" } }, "\u5927\u5C0F")
          ),
          entries.map((entry) => h(
            "div",
            {
              key: entry.path,
              role: "button",
              tabIndex: 0,
              title: entry.path,
              onClick: () => setSelected(entry),
              onDoubleClick: () => openFile(entry),
              onContextMenu: (event) => openContextMenu(event, entry, entry.dir ? entry.path : path),
              onKeyDown: (event) => {
                if (event.key === "Enter") openFile(entry);
              },
              className: "tether-hover",
              style: { display: "grid", gridTemplateColumns: columns, gap: 8, height: 30, padding: "0 8px", alignItems: "center", borderRadius: 6, fontSize: 13, color: C2.ink, background: selected && selected.path === entry.path ? C2.active : "transparent", cursor: "default" }
            },
            h(
              "div",
              { style: { display: "flex", alignItems: "center", gap: 7, minWidth: 0 } },
              h(
                "span",
                { style: { width: 16, height: 16, display: "grid", placeItems: "center", flex: "0 0 auto" } },
                h(Native.FileTypeIcon, entry.dir ? { kind: "folder", size: 15 } : { path: entry.path, size: 15 })
              ),
              h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, entry.name)
            ),
            h("span", { style: { color: C2.mute, fontSize: 11, whiteSpace: "nowrap" } }, formatMtime(entry.mtime)),
            h("span", { style: { color: C2.mute, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, entryTypeLabel(entry)),
            h("span", { className: "tether-num", style: { color: C2.mute, fontSize: 11, textAlign: "right" } }, entry.dir ? "" : formatBytes(entry.size))
          ))
        );
      };
      const menuItem = (icon, label, onClick, danger) => h("button", {
        onClick,
        className: "tether-hover",
        style: { display: "flex", alignItems: "center", gap: 8, width: "100%", height: 30, padding: "0 8px", border: 0, borderRadius: 6, background: "transparent", color: danger ? C2.red : C2.ink, fontSize: 13, textAlign: "left", cursor: "pointer" }
      }, h(Glyph, { name: icon, size: 15 }), h("span", null, label));
      const context = contextMenu ? h(
        "div",
        {
          onPointerDown: (event) => event.stopPropagation(),
          style: { position: "fixed", left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 190)), top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 250)), width: 178, zIndex: 60, background: C2.layer1, borderRadius: 8, boxShadow: C2.shadow, padding: 4, userSelect: "none" }
        },
        contextMenu.entry ? menuItem("file", "\u6253\u5F00", () => {
          setContextMenu(null);
          openFile(contextMenu.entry);
        }) : null,
        contextMenu.entry ? menuItem("pencil", "\u91CD\u547D\u540D", () => {
          const entry = contextMenu.entry;
          setContextMenu(null);
          renameEntry(entry);
        }) : null,
        contextMenu.entry ? menuItem("trash", "\u5220\u9664", () => {
          const entry = contextMenu.entry;
          setContextMenu(null);
          deleteEntry(entry);
        }, true) : null,
        contextMenu.entry ? h("div", { style: { height: 1, background: C2.line, margin: "4px 2px" } }) : null,
        menuItem("plus", "\u65B0\u5EFA\u6587\u4EF6", () => {
          const base = contextMenu.base;
          setContextMenu(null);
          makeFile(base);
        }),
        menuItem("files", "\u65B0\u5EFA\u6587\u4EF6\u5939", () => {
          const base = contextMenu.base;
          setContextMenu(null);
          makeFolder(base);
        }),
        h("div", { style: { height: 1, background: C2.line, margin: "4px 2px" } }),
        menuItem("refresh", "\u5237\u65B0", () => {
          setContextMenu(null);
          refreshExplorer();
        })
      ) : null;
      return h(
        "div",
        {
          onContextMenu: (event) => {
            if (!file) openContextMenu(event, null, path);
          },
          style: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0, background: C2.bg }
        },
        toolbar,
        file ? h("div", { style: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 } }, fileHeader, previewBody()) : directoryBody(),
        context
      );
    };
    const renderNetwork = () => {
      const devices = state && state.devices || [];
      const localId = state && state.local_device;
      const online = devices.filter((item) => item.online);
      const caps = (item) => {
        const values = [];
        const capabilities = item.capabilities || {};
        if (capabilities.surface_protocol === 1) values.push("\u63D2\u4EF6\u4E92\u8054");
        if (capabilities.app_protocol === 1) values.push("App \u4E92\u8054");
        if (capabilities.surface_protocol !== 1 && capabilities.app_protocol !== 1) values.push("\u63D2\u4EF6\u7248\u672C\u8FC7\u65E7");
        else if (!capabilities.fs) values.push("\u6587\u4EF6\u670D\u52A1\u7F3A\u5931");
        return values;
      };
      const openDevice = (item) => {
        setDeviceId(item.device_id);
        setView("chat");
        setActivePanel("workspaces");
        setSidebarCollapsed(true);
      };
      const renameDevice = (item) => {
        setDeviceMenu(null);
        askValue("\u91CD\u547D\u540D\u8282\u70B9", item.name || item.device_id, async (name) => {
          try {
            const updated = await post("/api/devices/" + encodeURIComponent(item.device_id) + "/name", { name });
            setState((current) => current ? {
              ...current,
              devices: current.devices.map((device2) => device2.device_id === updated.device_id ? updated : device2)
            } : current);
            setNotice("\u5DF2\u91CD\u547D\u540D\u4E3A\u300C" + (updated.name || updated.device_id) + "\u300D");
          } catch (error) {
            fail2(error);
          }
        });
      };
      const openDeviceMenu = (event, item) => {
        event.preventDefault();
        event.stopPropagation();
        setDeviceId(item.device_id);
        setDeviceMenu({ x: event.clientX, y: event.clientY, device: item });
      };
      const menuItem = (icon, label, onClick) => h("button", {
        onClick,
        className: "tether-hover",
        style: { display: "flex", alignItems: "center", gap: 8, width: "100%", height: 30, padding: "0 8px", border: 0, borderRadius: 6, background: "transparent", color: C2.ink, fontSize: 13, textAlign: "left", cursor: "pointer" }
      }, h(Glyph, { name: icon, size: 15 }), h("span", null, label));
      const deviceContext = deviceMenu ? h(
        "div",
        {
          onPointerDown: (event) => event.stopPropagation(),
          style: { position: "fixed", left: Math.max(8, Math.min(deviceMenu.x, window.innerWidth - 190)), top: Math.max(8, Math.min(deviceMenu.y, window.innerHeight - 110)), width: 178, zIndex: 60, background: C2.layer1, borderRadius: 8, boxShadow: C2.shadow, padding: 4, userSelect: "none" }
        },
        menuItem("monitor", "\u6253\u5F00\u539F\u751F\u5DE5\u4F5C\u533A", () => {
          const item = deviceMenu.device;
          setDeviceMenu(null);
          openDevice(item);
        }),
        menuItem("pencil", "\u91CD\u547D\u540D", () => renameDevice(deviceMenu.device))
      ) : null;
      const card = (item) => h(
        "div",
        {
          key: item.device_id,
          onClick: () => setDeviceId(item.device_id),
          onDoubleClick: () => openDevice(item),
          onContextMenu: (event) => openDeviceMenu(event, item),
          title: item.capabilities && item.capabilities.surface_protocol === 1 ? "\u53CC\u51FB\u6253\u5F00\u539F\u751F\u5DE5\u4F5C\u533A" : "\u63D2\u4EF6\u7248\u672C\u8FC7\u65E7\uFF0C\u53CC\u51FB\u67E5\u770B\u8BE6\u60C5",
          style: { background: item.device_id === deviceId ? C2.soft : C2.panel, borderRadius: 10, padding: "10px 12px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }
        },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 } },
          dot(item.online),
          h("span", { style: { fontWeight: "var(--tether-strong, 600)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, item.name || item.device_id),
          item.device_id === localId ? pill("\u672C\u673A", C2.mute) : null,
          h("span", { style: { marginLeft: "auto", fontSize: 10.5, color: item.online ? C2.green : C2.mute } }, item.online ? "\u5728\u7EBF" : "\u79BB\u7EBF")
        ),
        h("div", { style: { fontSize: 11, color: C2.mute, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, deviceOs(item)),
        h(
          "div",
          { style: { display: "flex", gap: 4, flexWrap: "wrap" } },
          caps(item).map((label) => pill(label, /过旧|缺失|受损|异常/.test(label) ? C2.amber : C2.mute))
        )
      );
      const pageSize = 8;
      const totalPages = Math.max(1, Math.ceil(devices.length / pageSize));
      const page = Math.min(networkPage, totalPages);
      const visible = devices.slice((page - 1) * pageSize, page * pageSize);
      const pager = totalPages > 1 ? h(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 2px 0", flex: "0 0 auto" } },
        h("button", { title: "\u4E0A\u4E00\u9875", "aria-label": "\u4E0A\u4E00\u9875", onClick: () => setNetworkPage(Math.max(1, page - 1)), disabled: page <= 1, className: "tether-hover", style: { width: 26, height: 26, display: "grid", placeItems: "center", border: 0, borderRadius: 6, background: "transparent", color: page <= 1 ? C2.mute : C2.sub, cursor: page <= 1 ? "default" : "pointer", opacity: page <= 1 ? 0.4 : 1 } }, h(Glyph, { name: "chevronLeft", size: 14 })),
        h("span", { className: "tether-num", style: { fontSize: 11, color: C2.mute } }, page + " / " + totalPages),
        h("button", { title: "\u4E0B\u4E00\u9875", "aria-label": "\u4E0B\u4E00\u9875", onClick: () => setNetworkPage(Math.min(totalPages, page + 1)), disabled: page >= totalPages, className: "tether-hover", style: { width: 26, height: 26, display: "grid", placeItems: "center", border: 0, borderRadius: 6, background: "transparent", color: page >= totalPages ? C2.mute : C2.sub, cursor: page >= totalPages ? "default" : "pointer", opacity: page >= totalPages ? 0.4 : 1 } }, h(Glyph, { name: "chevronRight", size: 14 }))
      ) : null;
      return h(
        "div",
        { style: { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", background: C2.bg } },
        h(
          "div",
          { style: { display: "flex", alignItems: "center", gap: 8, padding: "14px 18px 10px", flex: "0 0 auto" } },
          h("div", { style: { fontSize: 18, fontWeight: "var(--tether-strong, 600)" } }, "\u4E92\u8054"),
          pill(online.length + " / " + devices.length + " \u5728\u7EBF", online.length ? C2.green : C2.mute),
          h(
            "span",
            { style: { marginLeft: "auto" } },
            h(
              "button",
              { title: "\u5237\u65B0", "aria-label": "\u5237\u65B0", onClick: refreshNetwork, className: "tether-hover", style: { width: 28, height: 28, display: "grid", placeItems: "center", border: 0, borderRadius: 6, background: "transparent", color: C2.mute, cursor: "pointer" } },
              networkRefreshing ? h("span", { className: "tether-spin", style: { display: "grid", placeItems: "center" } }, h(Glyph, { name: "refresh", size: 16 })) : h(Glyph, { name: "refresh", size: 16 })
            )
          )
        ),
        h(
          "div",
          { style: { display: "flex", flex: "1 1 auto", minHeight: 0, padding: "0 18px 18px", alignItems: "stretch" } },
          h(
            "div",
            { style: { width: networkListWidth, flex: "0 0 auto", minHeight: 0, display: "flex", flexDirection: "column", transition: networkResizing ? "none" : "width 180ms cubic-bezier(.2,.85,.2,1.15)" } },
            h(
              "div",
              { className: "tether-scroll", style: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, paddingRight: 6 } },
              visible.map(card),
              !devices.length ? h("div", { style: { color: C2.mute, fontSize: 12 } }, "\u6682\u65E0\u8BBE\u5907 \xB7 \u76EE\u6807\u673A\u9700\u63A5\u5165 Hub") : null
            ),
            pager
          ),
          h("div", { className: "tether-resizer", title: "\u62D6\u52A8\u8C03\u6574\u5BBD\u5EA6\uFF0C\u53CC\u51FB\u590D\u4F4D", onPointerDown: startNetworkResize, onDoubleClick: () => setNetworkListWidth(300), style: { width: 6, flex: "0 0 auto", cursor: "col-resize", position: "relative" } }),
          h(
            "div",
            { style: { flex: "1 1 auto", minWidth: 0, minHeight: 0, position: "relative", background: C2.panel, borderRadius: 12, overflow: "hidden" } },
            h(NetworkGraph, { devices, localId, selectedId: deviceId, onSelect: (item) => setDeviceId(item.device_id), onOpen: openDevice, onContextMenu: openDeviceMenu })
          )
        ),
        deviceContext
      );
    };
    return h(
      "div",
      { className: "tether-root", style: { position: "relative", height: "100%", display: "flex", flexDirection: "column", background: C2.bg, color: C2.ink, fontSize: 13, fontWeight: "var(--tether-body, 400)", overflow: "hidden" } },
      h("style", null, SCROLL_CSS),
      h(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: 0, background: C2.soft, position: "relative", zIndex: 2, flex: "0 0 auto" } },
        h("strong", { style: { fontSize: 15 } }, "Tether"),
        device ? h(DeviceSwitcher, {
          devices: state && state.devices || [],
          value: deviceId,
          onChange: setDeviceId,
          onOpenNetwork: () => selectPanel("network")
        }) : h("span", { style: { color: C2.mute } }, "no device"),
        device && device.capabilities && (!device.capabilities.fs || device.capabilities.surface_protocol !== 1) ? pill("\u8282\u70B9\u5F85\u66F4\u65B0", C2.amber) : null
      ),
      notice ? h("div", { style: { padding: "6px 14px", background: C2.soft, color: /^Saved |^Policy updated|^已重命名/.test(notice) ? C2.green : C2.red, borderBottom: 0, fontSize: 12 } }, notice) : null,
      h(
        "div",
        { style: { display: "flex", flex: "1 1 auto", minHeight: 0 } },
        h(ActivityBar, {
          active: view === "files" ? "files" : view === "network" ? "network" : "workspaces",
          collapsed: sidebarCollapsed,
          onSelect: selectPanel,
          onSettings: openSettings,
          settingsOpen: showSettings
        }),
        h(SidePanel, {
          width: safeSidebarWidth,
          hidden: sidebarCollapsed || view !== "files",
          resizing,
          onResizeStart: startSidebarResize,
          onResetWidth: () => setSidebarWidth(UI.defaultSide),
          onCollapse: () => setSidebarCollapsed(true),
          loadingTree: Object.values(treeChildren).some((item) => item && item.status === "loading"),
          treeRoots: [
            { id: treeNodeId(deviceId, "workspaces", "", ""), label: "\u5DE5\u4F5C\u533A", first: true, nodes: workspaceNodes.map((w) => {
              const wid = w.id || w.workspace_id || w.path;
              return { id: treeNodeId(deviceId, "workspaces", wid, w.path), cacheKey: treeCacheKey(deviceId, w.path), deviceId, groupId: "workspaces", workspaceId: wid, name: w.name, path: w.path, dir: true };
            }) },
            { id: treeNodeId(deviceId, "drives", "", ""), label: "\u6B64\u7535\u8111", nodes: drives.map((d) => ({ id: treeNodeId(deviceId, "drives", "", d.path), cacheKey: treeCacheKey(deviceId, d.path), deviceId, groupId: "drives", workspaceId: "", name: d.name, path: d.path, dir: true })) },
            ...ungroupedPaths.length ? [{
              id: treeNodeId(deviceId, "ungrouped", "", ""),
              label: "\u672A\u5206\u7EC4",
              nodes: ungroupedPaths.map((item) => ({ id: treeNodeId(deviceId, "ungrouped", "", item), cacheKey: treeCacheKey(deviceId, item), deviceId, groupId: "ungrouped", workspaceId: "", name: pathBasename(item), path: item, dir: true }))
            }] : []
          ],
          treeChildren,
          treeOpen,
          onToggleTree: toggleTree,
          onOpenFile: openFile,
          onContextMenuNode: (event, node) => openContextMenu(event, { name: node.name, path: node.path, dir: node.dir }, node.dir ? node.path : parentOf(node.path)),
          treeSelected
        }),
        h(
          "main",
          { style: { flex: "1 1 auto", display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } },
          h(NativeSurface, { deviceId, online: deviceOnline, visible: view === "chat" }),
          view === "files" ? renderExplorer() : view === "network" ? renderNetwork() : null
        )
      ),
      showSettings ? h(
        "div",
        {
          onPointerDown: (event) => {
            if (event.target === event.currentTarget) setShowSettings(false);
          },
          style: { position: "absolute", inset: 0, background: "rgba(16,24,40,0.35)", display: "flex", justifyContent: "flex-end", zIndex: 20 }
        },
        h(
          "div",
          { className: "tether-drawer", style: { height: "100%", background: C2.bg, borderLeft: 0, display: "flex", flexDirection: "column", boxShadow: C2.shadow } },
          h(
            "div",
            { style: { padding: "12px 16px", borderBottom: 0, background: C2.panel, display: "flex", alignItems: "center" } },
            h("strong", null, "\u6587\u4EF6\u6743\u9650"),
            device ? h("span", { style: { marginLeft: 8, fontSize: 12, color: C2.mute } }, device.name) : null,
            h("button", { onClick: () => setShowSettings(false), style: { marginLeft: "auto", border: 0, background: "transparent", fontSize: 18, cursor: "pointer", color: C2.mute } }, "\xD7")
          ),
          h(
            "div",
            { className: "tether-drawer-body", style: { overflow: "hidden", flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" } },
            h(
              "div",
              { style: { flex: "0 0 auto", maxHeight: "58%", overflowY: "auto" } },
              h(
                "div",
                { style: { display: "grid", gap: 6, marginBottom: 4 } },
                [
                  ["readonly", "\u9ED8\u8BA4\uFF08\u53EA\u8BFB + \u9879\u76EE\u53EF\u5199\uFF09", "\u5168\u76D8\u53EF\u8BFB\uFF1B\u53EA\u5199\u9879\u76EE\u6839\u4E0E\u4E0B\u5217\u76EE\u5F55"],
                  ["locked", "\u9501\u5B9A\uFF08\u5168\u90E8\u53EA\u8BFB\uFF09", "\u62D2\u7EDD\u6240\u6709\u5199\u5165\u4E0E\u5220\u9664"],
                  ["full", "\u5168\u76D8\u8BFB\u5199", "\u7CFB\u7EDF\u4E0E\u51ED\u636E\u76EE\u5F55\u4ECD\u62D2\u7EDD"]
                ].map(([value, title, desc]) => h(
                  "label",
                  { key: value, title: desc, style: { border: 0, borderRadius: 8, padding: "8px 10px", cursor: "pointer", background: mode === value ? C2.soft : C2.panel } },
                  h("div", { style: { display: "flex", alignItems: "center", gap: 6 } }, h("input", { type: "radio", checked: mode === value, onChange: () => setMode(value) }), h("strong", { style: { fontSize: 13 } }, title))
                ))
              ),
              h(
                "div",
                { title: "DSH \u5DE5\u4F5C\u533A\u4E0E\u8282\u70B9\u5DE5\u4F5C\u76EE\u5F55\u59CB\u7EC8\u53EF\u5199", style: { display: "flex", alignItems: "center", height: 28, marginTop: 14, fontSize: 13, lineHeight: "20px", fontWeight: "var(--tether-body, 400)", color: C2.mute } },
                h("span", null, "\u53EF\u5199\u6839\u76EE\u5F55"),
                h("button", { title: "\u6DFB\u52A0\u53EF\u5199\u6839\u76EE\u5F55", "aria-label": "\u6DFB\u52A0\u53EF\u5199\u6839\u76EE\u5F55", onClick: addRoot, className: "tether-hover", style: { marginLeft: "auto", width: 26, height: 26, display: "grid", placeItems: "center", border: 0, borderRadius: 6, background: "transparent", color: C2.mute, cursor: "pointer" } }, h(Glyph, { name: "plus", size: 15 }))
              ),
              h(
                "div",
                { style: { borderRadius: 6, overflow: "hidden", background: C2.panel } },
                rootList().length ? rootList().map((root, index) => h(
                  "div",
                  {
                    key: index + ":" + root,
                    title: root,
                    style: { display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 8px", fontSize: 11.5, color: C2.sub }
                  },
                  h("span", { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "Consolas, monospace" } }, root),
                  h("button", { title: "\u7F16\u8F91", "aria-label": "\u7F16\u8F91", onClick: () => editRoot(index), className: "tether-hover", style: { width: 24, height: 24, display: "grid", placeItems: "center", border: 0, borderRadius: 5, background: "transparent", color: C2.mute, cursor: "pointer" } }, h(Glyph, { name: "pencil", size: 14 })),
                  h("button", { title: "\u5220\u9664", "aria-label": "\u5220\u9664", onClick: () => removeRoot(index), className: "tether-hover", style: { width: 24, height: 24, display: "grid", placeItems: "center", border: 0, borderRadius: 5, background: "transparent", color: C2.mute, cursor: "pointer" } }, h(Glyph, { name: "trash", size: 14 }))
                )) : h("div", { style: { padding: "8px", fontSize: 11.5, color: C2.mute } }, "\u672A\u6DFB\u52A0\u989D\u5916\u76EE\u5F55")
              ),
              h(
                "div",
                { style: { display: "flex", gap: 8, marginTop: 10, alignItems: "center" } },
                h("button", { onClick: savePolicy, disabled: busy || !device || !device.online, className: "tether-press tether-hover", title: policy ? "\u66F4\u65B0\u4E8E " + (policy.updated_by || "default") : "", style: { height: 28, padding: "0 10px", borderRadius: 6, border: 0, background: C2.primary, color: C2.onPrimary, fontSize: 12, cursor: busy || !device || !device.online ? "not-allowed" : "pointer", opacity: busy || !device || !device.online ? 0.5 : 1, display: "flex", alignItems: "center", gap: 6 } }, h(Glyph, { name: "save", size: 14 }), "\u4FDD\u5B58\u6743\u9650")
              )
            ),
            h(
              "div",
              { style: { flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" } },
              h("div", { title: "Tether \u6587\u4EF6\u670D\u52A1\u64CD\u4F5C\uFF0C\u4E0D\u542B DSH Agent \u547D\u4EE4\uFF1B\u5199\u5165\u542B intent/result", style: { fontSize: 12.5, lineHeight: "20px", fontWeight: "var(--tether-body, 400)", color: C2.mute, margin: "12px 0 6px", flex: "0 0 auto" } }, "\u5BA1\u8BA1 \xB7 " + (auditCount || 0) + " / " + (auditRetained || 1e5)),
              h(
                "div",
                { style: { border: 0, borderRadius: 6, overflow: "hidden", background: C2.panel, flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" } },
                h("div", { className: "tether-audit-head" }, h("span", null, "\u64CD\u4F5C"), h("span", null, "\u8DEF\u5F84"), h("span", null, "\u7ED3\u679C")),
                h(
                  "div",
                  { style: { flex: "1 1 auto", minHeight: 0, overflow: "auto" } },
                  audit.map((a, i) => h(
                    "div",
                    { key: i, className: "tether-audit-row", style: { background: i % 2 ? C2.bg : "transparent", color: a.result === "denied" ? C2.red : C2.sub } },
                    h("span", null, a.op),
                    h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: a.path }, a.path),
                    h("span", null, a.phase === "intent" ? a.result === "denied" ? "denied" : "intent" : a.result)
                  )),
                  !audit.length ? h("div", { style: { padding: 10, fontSize: 11, color: C2.mute } }, "\u6682\u65E0\u5BA1\u8BA1") : null
                )
              ),
              audit.length < auditCount ? h(
                "div",
                { style: { textAlign: "center", paddingTop: 8, flex: "0 0 auto" } },
                h("button", { onClick: loadMoreAudit, disabled: auditLoading, className: "tether-hover", style: { border: 0, borderRadius: 6, padding: "5px 12px", background: C2.soft, color: C2.ink, fontSize: 12, cursor: auditLoading ? "default" : "pointer", opacity: auditLoading ? 0.6 : 1 } }, auditLoading ? "\u52A0\u8F7D\u4E2D\u2026" : "\u52A0\u8F7D\u66F4\u591A")
              ) : null
            )
          )
        )
      ) : null,
      ask ? h(
        "div",
        { style: { position: "absolute", inset: 0, background: "rgba(16,24,40,0.35)", display: "grid", placeItems: "center", zIndex: 30 } },
        h(
          "div",
          { style: { width: 380, background: C2.bg, borderRadius: 10, boxShadow: C2.shadow, padding: 18 } },
          h("div", { style: { fontSize: 14, fontWeight: "var(--tether-strong, 600)", marginBottom: 10 } }, ask.title),
          h("input", { autoFocus: true, value: ask.value, spellCheck: false, onChange: (ev) => setAsk({ ...ask, value: ev.target.value }), onKeyDown: (ev) => {
            if (ev.key === "Enter") submitAsk();
            if (ev.key === "Escape") setAsk(null);
          }, style: { width: "100%", height: 32, boxSizing: "border-box", border: 0, borderRadius: 6, padding: "0 8px", background: C2.panel, fontSize: 13 } }),
          h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 } }, btn("\u53D6\u6D88", () => setAsk(null)), btn("\u786E\u5B9A", submitAsk, { primary: true, disabled: !ask.value.trim() }))
        )
      ) : null
    );
  }
  function TetherIcon() {
    return h("span", { title: "Tether", style: { display: "grid", placeItems: "center", width: 16, height: 16, borderRadius: 4, background: C2.primary, color: C2.onPrimary, fontSize: 10, lineHeight: "16px", fontFamily: "inherit", fontWeight: "var(--tether-strong-2, 700)", flex: "0 0 auto" } }, "T");
  }
  return { App, TetherIcon };
}

// src/hosts/web.js
var EXT_KIND = {
  md: "md",
  markdown: "md",
  mdx: "md",
  txt: "text",
  log: "text",
  ini: "text",
  cfg: "text",
  pdf: "pdf",
  doc: "doc",
  docx: "doc",
  rtf: "doc",
  odt: "doc",
  wps: "doc",
  ppt: "ppt",
  pptx: "ppt",
  odp: "ppt",
  dps: "ppt",
  xls: "xls",
  xlsx: "xls",
  csv: "xls",
  ods: "xls",
  et: "xls",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  svg: "image",
  ico: "image",
  tif: "image",
  tiff: "image",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  gz: "archive",
  tar: "archive",
  js: "code",
  mjs: "code",
  cjs: "code",
  ts: "code",
  tsx: "code",
  jsx: "code",
  py: "code",
  ps1: "code",
  sh: "code",
  bat: "code",
  json: "code",
  yml: "code",
  yaml: "code",
  toml: "code",
  html: "code",
  css: "code",
  java: "code",
  c: "code",
  cpp: "code",
  h: "code",
  go: "code",
  rs: "code",
  exe: "binary",
  dll: "binary",
  bin: "binary",
  msi: "binary"
};
var KIND_COLOR = {
  pdf: "#d64545",
  doc: "#2b6cb0",
  ppt: "#dd6b20",
  xls: "#2f855a",
  image: "#6b46c1",
  md: "#334155",
  text: "#64748b",
  code: "#0f766e",
  archive: "#b7791f",
  binary: "#475569",
  unknown: "#94a3b8"
};
var GLYPHS = {
  ppt: [["path", { d: "M4.6 5.2h6.8v4.6H4.6z" }], ["path", { d: "M6.2 11.8h3.6M8 9.8v2" }]],
  doc: [["path", { d: "M4.8 5.4h6.4M4.8 8h6.4M4.8 10.6h4.2" }]],
  pdf: [["path", { d: "M5.2 4.2h4.1l1.5 1.5v6.1H5.2z" }], ["path", { d: "M6.6 7.2h2.8M6.6 9.2h2.8" }]],
  xls: [["path", { d: "M4.6 5.2h6.8v5.6H4.6zM4.6 8h6.8M8 5.2v5.6" }]],
  image: [["circle", { cx: 6.4, cy: 6.6, r: 0.9 }], ["path", { d: "M4.4 11.4 7 8.6l1.6 1.6 1.2-1.1 1.8 2.3z" }]],
  md: [["path", { d: "M4.4 10.6V5.9l2 2.1 2-2.1v4.7" }], ["path", { d: "M11.2 6v4.6M9.9 9.4l1.3 1.3 1.3-1.3" }]],
  text: [["path", { d: "M4.8 5.4h6.4M4.8 8h6.4M4.8 10.6h3.4" }]],
  code: [["path", { d: "M6.6 5.8 4.2 8l2.4 2.2M9.4 5.8 11.8 8l-2.4 2.2" }]],
  archive: [["path", { d: "M8 3.9v1.1M8 6v1.1M8 8.1v1.1M8 10.2v1.1" }], ["path", { d: "M6.8 5h2.4M6.8 9.2h2.4" }]],
  binary: [["path", { d: "M5.2 6 6.7 8l-1.5 2M8.4 10h2.4" }]],
  unknown: [["path", { d: "M5.2 4.4h4l1.6 1.6v5.6H5.2z" }], ["path", { d: "M6.6 7.2h2.8M6.6 9.2h2.2" }]]
};
function fileKind(path) {
  const name = String(path || "").split(/[\\/]/).pop();
  if (!name || !name.includes(".")) return "unknown";
  return EXT_KIND[name.split(".").pop().toLowerCase()] || "unknown";
}
function createWebFileTypeIcon(React2) {
  const h = React2.createElement;
  return function WebFileTypeIcon({ path, kind, size = 16 }) {
    if (kind === "folder") {
      return h("svg", {
        "aria-hidden": true,
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        style: { flex: "0 0 auto", color: "var(--dsw-alias-label-tertiary, #667085)" }
      }, h("path", {
        d: "M2 4.6A1.6 1.6 0 0 1 3.6 3h2.5l1.3 1.4h5A1.6 1.6 0 0 1 14 6v5.4A1.6 1.6 0 0 1 12.4 13H3.6A1.6 1.6 0 0 1 2 11.4v-6.8Z",
        stroke: "currentColor",
        strokeWidth: 1.2
      }));
    }
    const type = fileKind(path);
    const shapes = GLYPHS[type] || GLYPHS.unknown;
    return h(
      "svg",
      {
        "aria-hidden": true,
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        style: { flex: "0 0 auto" }
      },
      h("rect", { x: 1.5, y: 1.5, width: 13, height: 13, rx: 3, fill: KIND_COLOR[type] || KIND_COLOR.unknown }),
      ...shapes.map((shape, index) => h(shape[0], {
        key: index,
        ...shape[1],
        stroke: "#ffffff",
        strokeWidth: 1.2,
        strokeLinecap: "round",
        strokeLinejoin: "round"
      }))
    );
  };
}
function createWebFileEntryRow(React2) {
  const h = React2.createElement;
  const FileTypeIcon = createWebFileTypeIcon(React2);
  return function WebFileEntryRow({ entry, tree, expanded }) {
    const isDir = entry.type === "directory";
    const activate = () => {
      if (isDir) {
        if (tree && tree.onToggle) tree.onToggle();
      } else if (tree && tree.onOpen) tree.onOpen();
    };
    const icon = h(FileTypeIcon, { path: entry.name, kind: isDir ? "folder" : "file", size: 16 });
    return h(
      "button",
      {
        type: "button",
        className: "tether-web-file-row",
        onClick: activate,
        style: {
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          minWidth: 0,
          height: 30,
          padding: "0 6px",
          border: 0,
          borderRadius: 6,
          background: "transparent",
          color: "inherit",
          font: "inherit",
          textAlign: "left",
          cursor: "pointer"
        }
      },
      h("span", {
        style: { width: 9, flex: "0 0 auto", color: "var(--dsw-alias-label-tertiary, #667085)", fontSize: 8 }
      }, isDir ? expanded ? "\u25BC" : "\u25B6" : ""),
      icon,
      h("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, entry.name)
    );
  };
}
function inline(React2, text, keyBase) {
  const h = React2.createElement;
  const nodes = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match;
  let index = 0;
  while (match = pattern.exec(text)) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) nodes.push(h("strong", { key: keyBase + "-" + index }, token.slice(2, -2)));
    else if (token.startsWith("`")) nodes.push(h("code", { key: keyBase + "-" + index, style: { padding: "1px 5px", borderRadius: 4, background: "var(--dsw-alias-markdown-code-block, #f8fafc)", fontSize: "0.92em" } }, token.slice(1, -1)));
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      nodes.push(h("a", { key: keyBase + "-" + index, href: link[2], target: "_blank", rel: "noreferrer", style: { color: "var(--dsw-alias-state-business-primary, #1570ef)" } }, link[1]));
    }
    last = match.index + token.length;
    index += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
function createWebMarkdownText(React2) {
  const h = React2.createElement;
  return function WebMarkdownText({ text }) {
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    let fence = null;
    let buffer = [];
    const flush = () => {
      if (!buffer.length) return;
      blocks.push(h("p", { key: "p" + blocks.length, style: { margin: "0 0 12px", lineHeight: "24px" } }, inline(React2, buffer.join(" "), "i" + blocks.length)));
      buffer = [];
    };
    lines.forEach((line) => {
      if (line.startsWith("```")) {
        if (fence === null) {
          flush();
          fence = [];
        } else {
          blocks.push(h("pre", { key: "c" + blocks.length, style: { margin: "0 0 14px", padding: "10px 12px", borderRadius: 8, background: "var(--dsw-alias-markdown-code-block, #f8fafc)", overflow: "auto", fontSize: 12.5, lineHeight: "20px" } }, h("code", null, fence.join("\n"))));
          fence = null;
        }
        return;
      }
      if (fence !== null) {
        fence.push(line);
        return;
      }
      if (!line.trim()) {
        flush();
        return;
      }
      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      if (heading) {
        flush();
        const level = heading[1].length;
        blocks.push(h("div", { key: "h" + blocks.length, style: { fontSize: 26 - level * 3, fontWeight: 650, lineHeight: "36px", margin: "4px 0 10px" } }, inline(React2, heading[2], "h" + blocks.length)));
        return;
      }
      const listItem = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(line);
      if (listItem) {
        flush();
        blocks.push(h(
          "div",
          { key: "l" + blocks.length, style: { display: "flex", gap: 8, margin: "0 0 6px" } },
          h("span", { style: { color: "var(--dsw-alias-label-tertiary, #667085)" } }, /\d/.test(listItem[1]) ? listItem[1] : "\xB7"),
          h("span", null, inline(React2, listItem[2], "l" + blocks.length + "-"))
        ));
        return;
      }
      buffer.push(line);
    });
    flush();
    if (fence !== null) blocks.push(h("pre", { key: "c" + blocks.length, style: { margin: "0 0 14px", padding: "10px 12px", borderRadius: 8, background: "var(--dsw-alias-markdown-code-block, #f8fafc)", overflow: "auto", fontSize: 12.5 } }, h("code", null, fence.join("\n"))));
    return h("div", { className: "tether-web-markdown" }, blocks);
  };
}
function createWebNative(React2) {
  return {
    FileEntryRow: createWebFileEntryRow(React2),
    FileTypeIcon: createWebFileTypeIcon(React2),
    MarkdownText: createWebMarkdownText(React2),
    chatZh: {},
    workspaceZh: {},
    toolZh: {},
    markdownLabels: () => ({})
  };
}
function createWebHost({ apiBase = "" } = {}) {
  return {
    kind: "web",
    apiBase: () => apiBase
  };
}

// src/hosts/electron.js
function createElectronHost({ apiBase = "" } = {}) {
  return {
    ...createWebHost({ apiBase }),
    kind: "app"
  };
}

// src/app-services.js
var C = {
  ink: "var(--dsw-alias-label-primary, #101828)",
  sub: "var(--dsw-alias-label-secondary, #475467)",
  mute: "var(--dsw-alias-label-tertiary, #667085)",
  bg: "var(--dsw-alias-bg-base, #ffffff)",
  panel: "var(--dsw-specific-sidebar-fill, #f9fafb)",
  soft: "var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06))",
  line: "var(--dsw-alias-border-l1, rgba(9, 30, 66, 0.04))",
  green: "var(--dsw-alias-state-success-primary, #16a34a)",
  red: "var(--dsw-alias-state-error-primary, #b42318)",
  amber: "var(--dsw-alias-state-warn-primary, #b54708)",
  primary: "var(--dsw-alias-button-primary-fill, #101828)",
  onPrimary: "var(--dsw-alias-label-primary-inverted, #ffffff)",
  shadow: "var(--dsw-elevation-panel, 0 8px 24px rgba(16, 24, 40, 0.12))"
};
var LABELS = { online: "\u8FD0\u884C\u4E2D", starting: "\u542F\u52A8\u4E2D", running: "\u8FD0\u884C\u4E2D", stopped: "\u5DF2\u505C\u6B62", error: "\u51FA\u9519", offline: "\u79BB\u7EBF", external: "\u5916\u90E8\u7BA1\u7406" };
function createAppServices(React2) {
  const h = React2.createElement;
  const button = (label, onClick, opts) => {
    const o = opts || {};
    return h("button", {
      onClick,
      disabled: o.disabled,
      title: label,
      className: "tether-press tether-hover",
      style: {
        height: 28,
        padding: "0 12px",
        borderRadius: 6,
        border: 0,
        fontSize: 12,
        background: o.primary ? C.primary : C.soft,
        color: o.primary ? C.onPrimary : o.danger ? C.red : C.ink,
        cursor: o.disabled ? "not-allowed" : "pointer",
        opacity: o.disabled ? 0.5 : 1
      }
    }, label);
  };
  return function AppServices() {
    const bridge = typeof window !== "undefined" ? window.tetherApp : null;
    const [state, setState] = React2.useState(null);
    const [open, setOpen] = React2.useState(false);
    const [busy, setBusy] = React2.useState(false);
    const [error, setError] = React2.useState("");
    React2.useEffect(() => {
      if (!bridge || !bridge.services) return void 0;
      let alive = true;
      const load = async () => {
        try {
          const next = await bridge.services();
          if (alive) setState(next);
        } catch (failure) {
          if (alive) setError(String(failure && failure.message || failure));
        }
      };
      load();
      const timer = setInterval(load, 2e3);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, []);
    if (!bridge || !bridge.services) return null;
    const controller = state && state.controller || { state: "stopped", port: 18890 };
    const node = state && state.node || { state: "stopped", deviceOnline: false };
    const hub = !!(state && state.mode === "hub");
    const dot = state && state.error ? C.red : controller.state === "error" || controller.state === "offline" ? C.red : controller.state === "starting" || node.state === "starting" ? C.amber : controller.state === "online" ? C.green : C.mute;
    const action = async (name) => {
      setBusy(true);
      setError("");
      try {
        const next = await bridge[name]();
        if (next && next.controller) setState(next);
      } catch (failure) {
        setError(String(failure && failure.message || failure));
      } finally {
        setBusy(false);
      }
    };
    const row = (label, value, color) => h(
      "div",
      {
        style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, height: 32, fontSize: 12.5 }
      },
      h("span", { style: { color: C.mute } }, label),
      h("span", { style: { color: color || C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, value)
    );
    const chip = !open ? h(
      "button",
      {
        onClick: () => setOpen(true),
        title: "APP \u670D\u52A1\u72B6\u6001\u4E0E\u542F\u52A8/\u505C\u6B62",
        className: "tether-press tether-hover",
        style: {
          position: "fixed",
          top: 8,
          right: 14,
          zIndex: 10,
          height: 26,
          padding: "0 10px",
          borderRadius: 999,
          border: 0,
          background: C.bg,
          color: C.sub,
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          cursor: "pointer",
          boxShadow: "0 1px 2px rgba(16,24,40,0.06)"
        }
      },
      h("span", { style: { width: 7, height: 7, borderRadius: 4, background: dot, flex: "0 0 auto" } }),
      "\u670D\u52A1"
    ) : null;
    const drawer = open ? h(
      "div",
      {
        onPointerDown: (event) => {
          if (event.target === event.currentTarget) setOpen(false);
        },
        style: { position: "fixed", inset: 0, background: "rgba(16,24,40,0.35)", display: "flex", justifyContent: "flex-end", zIndex: 50 }
      },
      h(
        "div",
        { style: { width: "min(400px, 100%)", height: "100%", background: C.bg, display: "flex", flexDirection: "column", boxShadow: C.shadow } },
        h(
          "div",
          { style: { padding: "12px 16px", background: C.panel, display: "flex", alignItems: "center" } },
          h("span", { style: { fontWeight: 600, fontSize: 14, color: C.ink } }, "APP \u670D\u52A1"),
          h(
            "span",
            { style: { marginLeft: 8, fontSize: 11, color: C.mute } },
            state && state.mode === "external" ? "\u5DF2\u8FDE\u63A5\u5916\u90E8 Controller" : state && state.mode === "hub" ? "\u8FDC\u7AEF Hub" : state && state.mode === "standalone" ? "\u672C\u673A\u81EA\u4E3E" : "\u672A\u542F\u52A8"
          ),
          h("button", {
            onClick: () => setOpen(false),
            title: "\u5173\u95ED",
            "aria-label": "\u5173\u95ED",
            className: "tether-hover",
            style: { marginLeft: "auto", width: 28, height: 28, border: 0, borderRadius: 6, background: "transparent", color: C.mute, fontSize: 16, cursor: "pointer" }
          }, "\xD7")
        ),
        h(
          "div",
          { className: "tether-scroll", style: { flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "14px 16px 24px" } },
          h(
            "div",
            { style: { borderRadius: 8, background: C.panel, padding: "4px 12px", marginBottom: 14 } },
            row("Controller", (LABELS[controller.state] || controller.state) + " \xB7 :" + controller.port, controller.state === "error" || controller.state === "offline" ? C.red : controller.state === "starting" ? C.amber : C.green),
            row("Node", (LABELS[node.state] || node.state) + (state && state.device ? " \xB7 " + state.device : ""), node.state === "error" ? C.red : node.state === "starting" ? C.amber : C.green),
            row(hub ? "\u5728\u7EBF\u8BBE\u5907" : "\u8282\u70B9\u5728\u7EBF", node.deviceOnline ? "\u662F" : "\u5426", node.deviceOnline ? C.green : C.mute)
          ),
          state && state.error ? h("div", { style: { fontSize: 11.5, lineHeight: "18px", color: C.red, marginBottom: 12, wordBreak: "break-all" } }, state.error) : null,
          error ? h("div", { style: { fontSize: 11.5, lineHeight: "18px", color: C.red, marginBottom: 12, wordBreak: "break-all" } }, error) : null,
          h(
            "div",
            { style: { display: "flex", gap: 8, marginBottom: 10 } },
            hub ? button("\u91CD\u65B0\u63A2\u6D4B", () => action("startServices"), { primary: true, disabled: busy }) : [
              button("\u542F\u52A8", () => action("startServices"), { primary: true, disabled: busy }),
              button("\u91CD\u542F", () => action("restartServices"), { disabled: busy }),
              button("\u505C\u6B62", () => action("stopServices"), { danger: true, disabled: busy })
            ]
          ),
          h(
            "div",
            { style: { display: "flex", gap: 8, marginBottom: 16 } },
            button("\u6253\u5F00\u65E5\u5FD7\u76EE\u5F55", () => action("openLogs")),
            button("\u6253\u5F00\u6570\u636E\u76EE\u5F55", () => action("openDataDir"))
          ),
          h(
            "div",
            { style: { fontSize: 11.5, lineHeight: "19px", color: C.mute } },
            hub ? ["\u5F53\u524D\u901A\u8FC7 APP \u4EE3\u7406\u8FDE\u63A5\u8FDC\u7AEF Hub\uFF1A", h("code", null, state && state.remoteUrl || ""), "\u3002\u76EE\u6807\u673A Node \u7528 ", h("code", null, "wss://<hub>/ws/node"), " \u51FA\u7AD9\u6CE8\u518C\uFF1BController \u4E0D\u66B4\u9732\u660E\u6587\u7AEF\u53E3\u3002"] : ["\u63D2\u4EF6\u5728\u672C\u673A\u4F7F\u7528 ", h("code", null, "http://127.0.0.1:18890"), "\u3002\u672C\u673A\u81EA\u4E3E\u65F6 APP \u542F\u52A8 Controller \u4E0E Node\uFF1B\u5DF2\u6709\u5916\u90E8 Controller \u65F6\u53EA\u8FDE\u63A5\u3001\u4E0D\u62A2\u5360\u3002\u8DE8\u673A\u8FDE\u63A5\u8981\u6C42\u53CC\u65B9\u53EF\u8FBE\uFF08\u5C40\u57DF\u7F51/\u7AEF\u53E3\u8F6C\u53D1/Tailscale\uFF09\uFF0C\u6216\u7B49 Relay\uFF08Phase 3\uFF09\u3002"]
          ),
          state && state.python ? h("div", { style: { marginTop: 12, fontSize: 10.5, color: C.mute, fontFamily: "Consolas, monospace", wordBreak: "break-all" } }, state.python) : null
        )
      )
    ) : null;
    return h(React2.Fragment, null, chip, drawer);
  };
}

// web/main.js
function fail(error) {
  const box = document.getElementById("root");
  if (!box) return;
  const pre = document.createElement("pre");
  pre.style.cssText = "padding:24px;color:#b42318;font:13px/1.6 Consolas,monospace;white-space:pre-wrap";
  pre.textContent = "Tether WebUI failed to mount\n\n" + String(error && error.stack || error);
  box.replaceChildren(pre);
}
try {
  const inApp = typeof window !== "undefined" && !!window.tetherApp;
  const panel = createTetherPanel({
    React: import_react.default,
    Native: createWebNative(import_react.default),
    host: inApp ? createElectronHost({ apiBase: "" }) : createWebHost({ apiBase: "" })
  });
  const root = (0, import_client.createRoot)(document.getElementById("root"));
  if (inApp) {
    const Services = createAppServices(import_react.default);
    root.render(import_react.default.createElement(
      import_react.default.Fragment,
      null,
      import_react.default.createElement(panel.App),
      import_react.default.createElement(Services)
    ));
  } else {
    root.render(import_react.default.createElement(panel.App));
  }
} catch (error) {
  fail(error);
}
/*! Bundled license information:

react/cjs/react.production.min.js:
  (**
   * @license React
   * react.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

scheduler/cjs/scheduler.production.min.js:
  (**
   * @license React
   * scheduler.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)

react-dom/cjs/react-dom.production.min.js:
  (**
   * @license React
   * react-dom.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
