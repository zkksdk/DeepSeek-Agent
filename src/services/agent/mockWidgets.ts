/** 演示模式用的 widget 示例：指标卡 + 柱状图，纯 HTML/CSS/JS */
export const DEMO_WIDGET_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 18px 18px 14px;
    background: radial-gradient(120% 120% at 10% 0%, #1e2a5a 0%, #0d1020 55%, #0a0b14 100%);
    color: #e8ecff;
    font: 13px/1.5 system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif;
  }
  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .metric {
    padding: 10px 12px; border: 1px solid rgba(122, 162, 255, .16); border-radius: 12px;
    background: linear-gradient(160deg, rgba(57, 100, 254, .14), rgba(139, 92, 246, .08));
    animation: rise .5s ease both;
  }
  .metric:nth-child(2) { animation-delay: .08s; }
  .metric:nth-child(3) { animation-delay: .16s; }
  .label { color: #8f9bc4; font-size: 11px; letter-spacing: .04em; }
  .value { display: flex; align-items: baseline; gap: 6px; margin-top: 2px; }
  .num { font-size: 22px; font-weight: 700; letter-spacing: -.02em; }
  .delta { color: #4ade80; font-size: 11px; }
  .delta.down { color: #fca5a5; }
  .chart { margin-top: 14px; }
  .chart-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .chart-title { font-size: 11.5px; color: #9aa6d2; letter-spacing: .04em; }
  .legend { display: flex; gap: 10px; font-size: 10.5px; color: #7c87ae; }
  .dot { display: inline-block; width: 6px; height: 6px; margin-right: 4px; border-radius: 50%; background: #679efe; vertical-align: 1px; }
  .dot.purple { background: #a78bfa; }
  .bars { display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; height: 156px; align-items: end; }
  .bar { position: relative; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; }
  .bar i {
    display: block; width: 100%; height: var(--h); border-radius: 7px 7px 3px 3px;
    background: linear-gradient(180deg, #7aa2ff, #3f63d9 70%, rgba(63, 99, 217, .35));
    box-shadow: 0 8px 18px -12px rgba(122, 162, 255, .9);
    transform-origin: bottom; animation: grow .7s cubic-bezier(.2, .8, .2, 1) both;
    animation-delay: var(--d);
  }
  .bar span { margin-top: 6px; color: #7883aa; font-size: 10px; text-align: center; }
  @keyframes grow { from { transform: scaleY(.02); opacity: .2; } to { transform: scaleY(1); opacity: 1; } }
  @keyframes rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .spark { margin-top: 10px; display: flex; align-items: center; gap: 8px; color: #8f9bc4; font-size: 11px; }
  .spark svg { flex: 1; height: 26px; }
</style>
</head>
<body>
  <div class="metrics">
    <div class="metric"><div class="label">今日调用</div><div class="value"><span class="num" data-to="1284">0</span><span class="delta">+18%</span></div></div>
    <div class="metric"><div class="label">成功率</div><div class="value"><span class="num" data-to="99.2" data-dec="1">0</span><span class="delta">+0.4</span></div></div>
    <div class="metric"><div class="label">平均耗时</div><div class="value"><span class="num" data-to="312">0</span><span class="delta down">ms</span></div></div>
  </div>
  <div class="chart">
    <div class="chart-head">
      <span class="chart-title">近七日工具调用</span>
      <span class="legend"><span><i class="dot"></i>成功</span><span><i class="dot purple"></i>重试</span></span>
    </div>
    <div class="bars">
      <div class="bar" style="--h:38%; --d:.05s"><i></i><span>周一</span></div>
      <div class="bar" style="--h:56%; --d:.1s"><i></i><span>周二</span></div>
      <div class="bar" style="--h:47%; --d:.15s"><i></i><span>周三</span></div>
      <div class="bar" style="--h:72%; --d:.2s"><i></i><span>周四</span></div>
      <div class="bar" style="--h:64%; --d:.25s"><i></i><span>周五</span></div>
      <div class="bar" style="--h:88%; --d:.3s"><i></i><span>周六</span></div>
      <div class="bar" style="--h:100%; --d:.35s"><i></i><span>今天</span></div>
    </div>
  </div>
  <script>
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    document.querySelectorAll('.num').forEach((el) => {
      const to = Number(el.dataset.to || 0);
      const dec = Number(el.dataset.dec || 0);
      const start = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - start) / 900);
        el.textContent = (to * ease(p)).toFixed(dec);
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  </script>
</body>
</html>`
