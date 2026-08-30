'use strict';

// Keep the summary cards addressable even after their warning class changes.
if (typeof livePatchOldSummary === 'function') {
  livePatchOldSummary = function livePatchOldSummaryStable(active, configured) {
    const metric = document.querySelector('#tab-overview .summary-grid > .metric:nth-child(4)');
    if (metric) {
      const strong = metric.querySelector('strong');
      const small = metric.querySelector('small');
      if (strong) strong.textContent = configured ? String(active) : '未設定';
      if (small) small.textContent = configured ? '匿名運用ログ / 20分以内' : '無料監視を開始すると表示';
      metric.classList.toggle('warn-metric', !configured);
    }
    const trafficMetric = document.querySelector('#tab-traffic .summary-grid > .metric:nth-child(4)');
    if (trafficMetric) {
      const strong = trafficMetric.querySelector('strong');
      const small = trafficMetric.querySelector('small');
      if (strong) strong.textContent = configured ? String(active) : '未設定';
      if (small) small.textContent = configured ? '現在利用中 / 20分以内' : '無料監視を開始すると表示';
    }
  };
}

// Public repository health needs no token; load it as a same-origin script.
if (!document.querySelector('script[data-admin-public]')) {
  const script = document.createElement('script');
  script.src = './admin-public.js';
  script.defer = true;
  script.dataset.adminPublic = '1';
  document.head.appendChild(script);
}
