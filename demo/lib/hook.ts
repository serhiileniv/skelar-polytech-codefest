// ~15 s "pain" intro before the title card: a P1 escalation that turns out to need no code.
// Deterministic: render.ts calls window.__seek(t) per frame and screenshots it.
export const HOOK_S = 15;

export function hookScene(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=block" rel="stylesheet">
<style>
*{margin:0;box-sizing:border-box}
html,body{width:1440px;height:900px;overflow:hidden;background:#0b0e13;color:#e6e8ec;
font-family:"Instrument Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.clock{position:absolute;top:44px;left:0;right:0;text-align:center;font-size:30px;font-weight:600;color:#8a93a3;letter-spacing:.04em}
.clock b{color:#e6e8ec;font-variant-numeric:tabular-nums;font-size:44px;margin-left:12px}
.clock .d{display:inline-block;margin-left:18px;padding:6px 14px;border-radius:999px;background:#2a1416;color:#ff6b6b;font-size:24px;vertical-align:middle;opacity:0}
.win{position:absolute;left:220px;top:130px;width:1000px;height:700px;border-radius:18px;background:#141820;
border:1px solid #232a36;box-shadow:0 30px 80px rgba(0,0,0,.5);overflow:hidden;display:flex;flex-direction:column}
.hd{height:68px;flex:none;display:flex;align-items:center;gap:14px;padding:0 28px;border-bottom:1px solid #232a36;font-size:24px}
.ws{font-weight:700;color:#fff}.ch{color:#9aa3b2}.ch::before{content:"·";margin-right:14px;color:#4a5262}
.body{flex:1;display:flex;flex-direction:column;justify-content:flex-end;padding:20px 28px 26px;gap:16px;overflow:hidden}
.m{display:flex;gap:16px;opacity:0}
.av{width:48px;height:48px;flex:none;border-radius:12px;display:grid;place-items:center;font-weight:700;font-size:20px;color:#fff}
.who{font-size:20px;font-weight:700;color:#fff}.who span{font-weight:500;color:#7d8696;margin-left:10px;font-size:18px}
.tx{font-size:26px;line-height:1.35;color:#d7dbe2;margin-top:2px}
.alert{border-left:6px solid #e5484d;background:#1e1416;border-radius:10px;padding:14px 18px;margin-top:6px}
.alert .p1{font-weight:700;color:#ff6b6b}.alert .q{color:#fff;font-weight:600}.alert .meta{font-size:21px;color:#a8aebb;margin-top:6px}
.code{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:23px;background:#0d1016;border:1px solid #232a36;border-radius:10px;padding:10px 16px;margin-top:6px;color:#9fe0b0}
.code.dim{color:#9aa3b2}
.ov{position:absolute;inset:0;display:grid;place-items:center;background:rgba(8,10,14,.86);opacity:0}
.ov div{position:absolute;text-align:center;font-weight:700;letter-spacing:-.02em;line-height:1.12;opacity:0}
.l1{font-size:76px;color:#fff}.l1 em{font-style:normal;color:#7ea6e0}
.l2{font-size:84px;color:#fff}.l2 em{font-style:normal;color:#5b8bd0}
</style></head><body>
<div class="clock">on-call · <b id="clk">03:12</b><span class="d" id="dur">15 min</span></div>
<div class="win" id="win">
 <div class="hd"><span class="ws">PawPlan</span><span class="ch"># billing-alerts</span></div>
 <div class="body">
  <div class="m" id="m0"><div class="av" style="background:#e5484d">!</div><div><div class="who">Support escalation<span>03:12</span></div>
   <div class="alert"><div class="tx"><span class="p1">🔴 P1</span> · Escalated by support — <span class="q">“Password reset email never arrives”</span></div>
   <div class="meta">cust_002 · 3 attempts</div></div></div></div>
  <div class="m" id="m1"><div class="av" style="background:#1d4f91">A</div><div><div class="who">Andrii (on-call)<span>03:13</span></div><div class="tx">on it 😩</div></div></div>
  <div class="m" id="m2"><div class="av" style="background:#1d4f91">A</div><div><div class="who">Andrii (on-call)<span>03:16</span></div><div class="code dim">$ checking mail provider logs…</div></div></div>
  <div class="m" id="m3"><div class="av" style="background:#1d4f91">A</div><div><div class="who">Andrii (on-call)<span>03:21</span></div><div class="code">SMTP 250 OK ×3 — delivered</div></div></div>
  <div class="m" id="m4"><div class="av" style="background:#1d4f91">A</div><div><div class="who">Andrii (on-call)<span>03:24</span></div><div class="code">auth service: healthy</div></div></div>
  <div class="m" id="m5"><div class="av" style="background:#1d4f91">A</div><div><div class="who">Andrii (on-call)<span>03:27</span></div><div class="tx">…it was in her spam folder. Support could have sent a magic link.</div></div></div>
 </div>
</div>
<div class="ov" id="ov"><div class="l1" id="l1">15 minutes of on-call.<br><em>Zero code to fix.</em></div><div class="l2" id="l2">Most escalations<br><em>aren't bugs.</em></div></div>
<script>
const $=(id)=>document.getElementById(id);
const clamp=(x)=>Math.max(0,Math.min(1,x));
const ease=(x)=>1-Math.pow(1-clamp(x),3);
const ramp=(t,a,d)=>ease((t-a)/d);
const MSG=[0.4,3.0,3.9,5.1,6.3,9.2];
window.__seek=(t)=>{
  MSG.forEach((a,i)=>{const p=ramp(t,a,0.35),el=$("m"+i);el.style.opacity=p;el.style.transform="translateY("+(1-p)*40+"px)";});
  const sh=t>0.8&&t<1.6?Math.sin(t*90)*10*(1-(t-0.8)/0.8):0;
  $("win").style.transform="translateX("+sh+"px) translateY("+(1-ramp(t,0,0.4))*30+"px)";
  $("win").style.opacity=ramp(t,0,0.4);
  const min=12+Math.round(15*clamp((t-3.2)/5.6));
  $("clk").textContent="03:"+String(min).padStart(2,"0");
  $("dur").style.opacity=ramp(t,8.8,0.3);
  $("ov").style.opacity=ramp(t,10.2,0.4);
  const l1=ramp(t,10.4,0.4)*(1-ramp(t,12.8,0.3)),l2=ramp(t,13.1,0.4);
  $("l1").style.opacity=l1;$("l1").style.transform="scale("+(0.96+0.04*ramp(t,10.4,0.6))+")";
  $("l2").style.opacity=l2;$("l2").style.transform="scale("+(0.96+0.04*ramp(t,13.1,0.6))+")";
};
window.__seek(0);
</script></body></html>`;
}
