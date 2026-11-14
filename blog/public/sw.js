// عامل الخدمة: يعرض إشعار «مقال جديد» عند وصول إشعار من الموقع
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", function (e) {
  e.waitUntil(
    self.registration.showNotification("عامر_", {
      body: "نُشر مقال جديد. اضغط لقراءته.",
      icon: "/logo.jpg",
      badge: "/favicon.png",
      dir: "rtl",
      lang: "ar",
      tag: "new-post",
    })
  );
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ("focus" in list[i]) { list[i].navigate("/"); return list[i].focus(); }
      }
      return self.clients.openWindow("/");
    })
  );
});
