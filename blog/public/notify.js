// زر تفعيل الإشعارات في الصفحة الرئيسية
(function () {
  var btn = document.getElementById("notify-btn");
  if (!btn) return;
  var msg = document.getElementById("notify-msg");
  function say(t) { if (msg) msg.textContent = t || ""; }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    btn.hidden = true;
    return;
  }

  function toKey(b64) {
    var s = (b64 + "====".slice(b64.length % 4)).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function label(on) { btn.textContent = on ? "إيقاف الإشعارات" : "تفعيل الإشعارات"; btn.setAttribute("data-on", on ? "1" : ""); }
  function post(path, body) {
    return fetch("/api/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  var regP = navigator.serviceWorker.register("/sw.js");
  regP.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (s) { label(!!s); }).catch(function () { label(false); });

  btn.addEventListener("click", function () {
    btn.disabled = true;
    say("");
    regP.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub) {
          return post("unsubscribe", { endpoint: sub.endpoint }).then(function () { return sub.unsubscribe(); }).then(function () { label(false); say("تم إيقاف الإشعارات."); });
        }
        return Notification.requestPermission().then(function (perm) {
          if (perm !== "granted") { say("لم تُمنح صلاحية الإشعارات من المتصفح."); return; }
          return fetch("/api/vapid").then(function (r) { return r.json(); }).then(function (j) {
            if (!j.key) throw new Error("no key");
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(j.key) });
          }).then(function (s) {
            return post("subscribe", s.toJSON()).then(function (r) {
              if (!r.ok) throw new Error("save");
              label(true);
              say("تم التفعيل. سيصلك إشعار عند نشر مقال جديد.");
            });
          });
        });
      });
    }).catch(function () {
      say("تعذّر تفعيل الإشعارات حاليًا.");
    }).then(function () { btn.disabled = false; });
  });
})();
