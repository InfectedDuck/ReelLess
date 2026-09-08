import fs from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

const ROOT = "C:/Users/ASUS/Desktop/projects/reels_blocker";
const sharedSource = fs.readFileSync(ROOT + "/shared.js", "utf8");
const guardSource = fs.readFileSync(ROOT + "/site_guard.js", "utf8");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function fixture({ url, html, settings }) {
  const messages = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", () => {});
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
  dom.window.chrome = {
    storage: { local: { get: async () => ({ settingsV2: settings }) }, onChanged: { addListener() {} } },
    runtime: { sendMessage: async (m) => { messages.push(m); return {}; }, openOptionsPage() {} }
  };
  dom.window.eval(sharedSource);
  dom.window.eval(guardSource);
  await wait(200);
  return { dom, document: dom.window.document, messages };
}

const shared = (await import("file:///" + ROOT + "/shared.js")).default;
const defaults = shared.getDefaultSettings();

// Realistic-ish Instagram home feed: one normal post, one reel card, one normal post.
const feed = `<main role="main"><div id="feed">
  <article id="p1"><a href="/alice/">alice</a><div class="media"><img src="a.jpg"></div><a href="/p/AAA/">post</a></article>
  <article id="reel"><a href="/bob/">bob</a><div id="reelbody"><video></video></div><a id="reelink" href="/reel/XYZ/">reel</a></article>
  <article id="p2"><a href="/carol/">carol</a><div class="media"><img src="c.jpg"></div><a href="/p/BBB/">post</a></article>
</div></main>`;

function log(t, v) { console.log(`  ${t}: ${v}`); }

// ---- Baseline
let f = await fixture({ url: "https://www.instagram.com/", settings: defaults, html: feed });
let d = f.document;
console.log("BASELINE");
log("reel article hidden", d.getElementById("reel").getAttribute("data-reelless-hidden"));
log("p1 hidden", d.getElementById("p1").getAttribute("data-reelless-hidden"));

// ---- Case A: partial teardown INSIDE the hidden card (inner node removed, reel <a> kept)
console.log("\nCASE A: inner node removed, reel anchor kept");
d.getElementById("reelbody").remove();
await wait(250);
log("reel article hidden after inner teardown", d.getElementById("reel").getAttribute("data-reelless-hidden"));

// ---- Case B: the card is emptied entirely
console.log("\nCASE B: hidden card emptied entirely");
f = await fixture({ url: "https://www.instagram.com/", settings: defaults, html: feed });
d = f.document;
log("before", d.getElementById("reel").getAttribute("data-reelless-hidden"));
d.getElementById("reel").innerHTML = "";
await wait(250);
log("after empty", d.getElementById("reel").getAttribute("data-reelless-hidden"));

// ---- Case C: reel anchor momentarily loses href, content intact
console.log("\nCASE C: reel <a> loses href (content intact)");
f = await fixture({ url: "https://www.instagram.com/", settings: defaults, html: feed });
d = f.document;
const flips = [];
new f.dom.window.MutationObserver((rs) => rs.forEach((r) => flips.push(d.getElementById("reel").getAttribute("data-reelless-hidden"))))
  .observe(d.getElementById("reel"), { attributes: true, attributeFilter: ["data-reelless-hidden"] });
log("before", d.getElementById("reel").getAttribute("data-reelless-hidden"));
d.getElementById("reelink").removeAttribute("href");
await wait(250);
log("after href drop", d.getElementById("reel").getAttribute("data-reelless-hidden"));
log("children still present", d.getElementById("reel").children.length);
d.getElementById("reelink").setAttribute("href", "/reel/XYZ/");
await wait(250);
log("after href restored", d.getElementById("reel").getAttribute("data-reelless-hidden"));
log("flip sequence", JSON.stringify(flips));

// ---- Case D: href swapped to a NON-reel url (recycle to a normal post)
console.log("\nCASE D: reel <a> href swapped to a normal post url");
f = await fixture({ url: "https://www.instagram.com/", settings: defaults, html: feed });
d = f.document;
log("before", d.getElementById("reel").getAttribute("data-reelless-hidden"));
d.getElementById("reelink").setAttribute("href", "/p/ZZZ/");
await wait(250);
log("after swap", d.getElementById("reel").getAttribute("data-reelless-hidden"));

// ---- Case E: does a plain scroll-shaped mutation (inserting a post BELOW) unhide anything?
console.log("\nCASE E: new post appended below (ordinary infinite scroll)");
f = await fixture({ url: "https://www.instagram.com/", settings: defaults, html: feed });
d = f.document;
const seq = [];
new f.dom.window.MutationObserver((rs) => rs.forEach(() => seq.push(d.getElementById("reel").getAttribute("data-reelless-hidden"))))
  .observe(d.getElementById("reel"), { attributes: true, attributeFilter: ["data-reelless-hidden"] });
for (let i = 0; i < 5; i++) {
  const a = d.createElement("article");
  a.innerHTML = `<a href="/u${i}/">u</a><img src="x.jpg"><a href="/p/N${i}/">p</a>`;
  d.getElementById("feed").appendChild(a);
  await wait(60);
}
await wait(250);
log("reel still hidden", d.getElementById("reel").getAttribute("data-reelless-hidden"));
log("flips on the hidden reel during appends", JSON.stringify(seq));

// ---- Case F: same-pass unhide-A + hide-B (the scroll-anchoring premise)
console.log("\nCASE F: one pass, unhide old card AND hide a new card?");
f = await fixture({ url: "https://www.instagram.com/", settings: defaults, html: feed });
d = f.document;
const passLog = [];
new f.dom.window.MutationObserver((rs) => {
  rs.forEach((r) => passLog.push(`${r.target.id}=${r.target.getAttribute("data-reelless-hidden")}`));
}).observe(d.getElementById("feed"), { attributes: true, subtree: true, attributeFilter: ["data-reelless-hidden"] });
// In one microtask batch: drop the href on the existing hidden reel AND append a new reel card.
d.getElementById("reelink").removeAttribute("href");
const nu = d.createElement("article");
nu.id = "newreel";
nu.innerHTML = `<a href="/dave/">dave</a><a href="/reel/NEW/">reel</a>`;
d.getElementById("feed").appendChild(nu);
await wait(250);
log("attribute writes seen", JSON.stringify(passLog));
log("reel", d.getElementById("reel").getAttribute("data-reelless-hidden"));
log("newreel", d.getElementById("newreel").getAttribute("data-reelless-hidden"));
