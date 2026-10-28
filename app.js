/* 과학실 시약 안내 — 화면 스크립트
 * 데이터는 모두 Apps Script(구글 시트)에서 받아 옵니다. 이 파일에는 비밀 정보가 없습니다. */
(function () {
  "use strict";

  const CFG = window.CHEM_CONFIG || {};
  const API = CFG.API_URL || "";
  const app = document.getElementById("app");
  const KEY_STORE = "chem_site_key";
  const T_STORE = "chem_teacher";

  let conf = null;          // { doors, units, risks, teachers }
  let items = null;         // 시약 목록
  let itemsAt = 0;
  let lastResult = null;    // 사용 기록 결과 화면용
  let searchText = "";

  document.getElementById("siteName").textContent = CFG.SCHOOL_NAME || "과학실 시약 안내";

  /* ---------- 처음 들어올 때: QR 주소의 키와 도어 처리 ---------- */
  (function readQuery() {
    const q = new URLSearchParams(location.search);
    const k = q.get("k");
    if (k && /^[A-Za-z0-9]{8,64}$/.test(k)) safeSet(localStorage, KEY_STORE, k);
    const door = q.get("door");
    if (k || door) {
      const hash = door ? "#/door/" + encodeURIComponent(door) : (location.hash || "#/");
      history.replaceState(null, "", location.pathname + hash);
    }
  })();

  /* ---------- 공통 ---------- */
  function safeGet(st, k) { try { return st.getItem(k); } catch (e) { return null; } }
  function safeSet(st, k, v) { try { st.setItem(k, v); } catch (e) { /* 저장 불가해도 동작 */ } }
  function safeDel(st, k) { try { st.removeItem(k); } catch (e) { } }
  function siteKey() { return safeGet(localStorage, KEY_STORE) || ""; }
  function teacher() { try { return JSON.parse(safeGet(sessionStorage, T_STORE) || "null"); } catch (e) { return null; } }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  function loading(msg) { app.innerHTML = '<div class="loading"><div class="spin"></div>' + esc(msg || "불러오는 중…") + "</div>"; }
  function showError(msg) {
    app.innerHTML = '<div class="error-box">' + esc(msg) + '</div><div class="btns"><a class="btn" href="#/">처음으로</a></div>';
  }

  async function api(action, payload) {
    if (!API || API.indexOf("http") !== 0) throw new Error("config.js에 웹 앱 주소(API_URL)가 아직 입력되지 않았습니다.");
    const body = JSON.stringify(Object.assign({ action: action }, payload || {}));
    let res;
    try { res = await fetch(API, { method: "POST", body: body, redirect: "follow" }); }
    catch (e) { throw new Error("서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요."); }
    let j;
    try { j = await res.json(); }
    catch (e) { throw new Error("서버 응답을 읽지 못했습니다. 웹 앱 배포 설정(액세스: 모든 사용자)을 확인해 주세요."); }
    if (!j.ok) throw new Error(j.error || "처리하지 못했습니다.");
    return j.data;
  }
  function tAuth() { const t = teacher(); return t ? { teacher: t.teacher, pw: t.pw } : {}; }

  async function loadConf() {
    if (conf) return conf;
    const cached = safeGet(sessionStorage, "chem_conf");
    if (cached) { try { conf = JSON.parse(cached); return conf; } catch (e) { } }
    conf = await api("config");
    safeSet(sessionStorage, "chem_conf", JSON.stringify(conf));
    return conf;
  }
  async function loadItems(force) {
    if (!force && items && Date.now() - itemsAt < 60000) return items;
    items = await api("list");
    itemsAt = Date.now();
    return items;
  }
  function doorOf(code) { return (conf && conf.doors || []).find(function (d) { return d.code === code; }); }
  function doorName(code) { const d = doorOf(code); return d ? d.label : (code || "미지정"); }
  function total(it) { return (it.unop || 0) + (it.open || 0); }
  function spec(it) {
    return [it.conc, it.vol ? it.vol + (it.unit || "") : "", it.maker].filter(Boolean).join(" · ");
  }
  function riskBadge(r) {
    const label = { HIGH: "고위험", MEDIUM: "주의", LOW: "일반" }[r] || r;
    return '<span class="badge ' + esc(r) + '">' + esc(label) + "</span>";
  }
  function casOf(it) { const m = /\b\d{2,7}-\d{2}-\d\b/.exec(it.formula || ""); return m ? m[0] : ""; }

  function setTeacherLink() {
    const a = document.getElementById("teacherLink");
    const t = teacher();
    a.textContent = t ? t.teacher + " 선생님" : "교사";
    a.classList.toggle("on", !!t);
  }

  /* ---------- 화면 이동 ---------- */
  async function route() {
    setTeacherLink();
    const parts = (location.hash || "#/").slice(2).split("/").map(decodeURIComponent);
    window.scrollTo(0, 0);
    try {
      await loadConf();
      if (!parts[0]) return await viewHome();
      if (parts[0] === "door") return await viewDoor(parts[1]);
      if (parts[0] === "item") return await viewItem(parts[1]);
      if (parts[0] === "use") return await viewUse(parts[1]);
      if (parts[0] === "done") return viewDone();
      if (parts[0] === "teacher") return await viewTeacher(parts[1] || "pending");
      return await viewHome();
    } catch (e) {
      showError(e.message);
    }
  }
  window.addEventListener("hashchange", route);

  /* ---------- 메인 ---------- */
  async function viewHome() {
    loading();
    const list = await loadItems();
    const count = {}, high = {};
    list.forEach(function (it) {
      count[it.door] = (count[it.door] || 0) + 1;
      if (it.risk === "HIGH") high[it.door] = true;
    });
    const doorHtml = function (code, wide) {
      const d = doorOf(code); if (!d) return "";
      return '<a class="door' + (wide ? " wide" : "") + (high[code] ? " hg" : "") + '" href="#/door/' + esc(code) + '">' +
        '<span class="code">' + esc(code.replace(/^([AB])(\d+)$/, function (_, c, n) { return n.length > 1 ? c + " " + n.split("").join("·") : c + " " + n; })) + "</span>" +
        '<span class="what">' + esc(d.desc) + "</span>" +
        '<span class="cnt">' + (count[code] || 0) + "종</span></a>";
    };
    app.innerHTML =
      "<h1>어떤 시약을 찾나요?</h1>" +
      '<p class="sub">이름으로 찾거나, 시약장 도어를 눌러 보관 중인 시약을 확인하세요.</p>' +
      '<div class="search"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
      '<input id="q" type="search" placeholder="예: 염산, NaCl, 메탄올" autocomplete="off" value="' + esc(searchText) + '"></div>' +
      '<div id="results"></div>' +
      '<div id="cabs"><div class="cabinets">' +
      '<div class="cabinet"><p class="cabinet-title">시약장 A</p><div class="doors">' + doorHtml("A1") + doorHtml("A2") + doorHtml("A3") + doorHtml("A4") + "</div></div>" +
      '<div class="cabinet"><p class="cabinet-title">시약장 B</p><div class="doors">' + doorHtml("B12", true) + doorHtml("B3") + doorHtml("B4") + "</div></div>" +
      "</div></div>";
    const q = document.getElementById("q");
    const draw = function () {
      searchText = q.value;
      const s = q.value.trim().toLowerCase().replace(/\s+/g, "");
      const res = document.getElementById("results");
      document.getElementById("cabs").style.display = s ? "none" : "";
      if (!s) { res.innerHTML = ""; return; }
      const hit = list.filter(function (it) {
        return [it.name, it.en, it.formula, it.maker].join(" ").toLowerCase().replace(/\s+/g, "").indexOf(s) >= 0;
      });
      res.innerHTML = hit.length ? '<div class="list">' + hit.map(itemRow).join("") + "</div>"
        : '<div class="empty-state">찾는 시약이 없습니다. 다른 이름이나 화학식으로 찾아보세요.</div>';
    };
    q.addEventListener("input", draw);
    draw();
  }

  function itemRow(it) {
    const n = total(it);
    return '<a class="item' + (n === 0 ? " empty" : "") + '" href="#/item/' + encodeURIComponent(it.id) + '">' +
      '<span class="nm">' + esc(it.name) + riskBadge(it.risk) + "</span>" +
      '<span class="bottles"><b>' + n + "병</b>" + (n === 0 ? "재고 없음" : "미개봉 " + it.unop + " · 개봉 " + it.open) + "</span>" +
      '<span class="meta">' + esc(spec(it) || " ") + ' · <b>' + esc(it.door || "미지정") + "</b></span></a>";
  }

  /* ---------- 도어 ---------- */
  async function viewDoor(code) {
    loading();
    const d = doorOf(code);
    if (!d) return showError("알 수 없는 도어입니다: " + code);
    const list = (await loadItems()).filter(function (it) { return it.door === code; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, "ko"); });
    const hasHigh = list.some(function (it) { return it.risk === "HIGH"; });
    app.innerHTML =
      '<a class="crumb" href="#/">← 시약장 전체</a>' +
      "<h1>" + esc(d.label) + "</h1>" +
      '<p class="sub">' + esc(d.desc) + " · " + list.length + "종</p>" +
      (hasHigh ? '<div class="warn HIGH" style="margin:0 0 14px"><strong>고위험 시약이 있습니다</strong>꺼내기 전에 선생님께 먼저 알리세요.</div>' : "") +
      (list.length ? '<div class="list">' + list.map(itemRow).join("") + "</div>" : '<div class="empty-state">이 도어에 등록된 시약이 없습니다.</div>');
  }

  /* ---------- 시약 상세 ---------- */
  async function viewItem(id) {
    loading();
    const it = (await loadItems()).find(function (x) { return x.id === id; });
    if (!it) return showError("시약을 찾지 못했습니다.");
    const cas = casOf(it);
    const msdsBtns =
      (it.msds ? '<a class="btn dark" href="' + esc(it.msds) + '" target="_blank" rel="noopener">MSDS 보기 (제조사 자료)</a>' : "") +
      '<a class="btn" href="https://msds.kosha.or.kr/MSDSInfo/" target="_blank" rel="noopener">KOSHA MSDS 검색</a>' +
      (cas ? '<button class="btn small" id="copyCas" type="button" style="justify-self:start">CAS번호 ' + esc(cas) + " 복사</button>" : "");
    app.innerHTML =
      '<a class="crumb" href="#/door/' + esc(it.door) + '">← ' + esc(doorName(it.door)) + "</a>" +
      "<h1>" + esc(it.name) + riskBadge(it.risk) + "</h1>" +
      (it.en ? '<p class="sub">' + esc(it.en) + "</p>" : '<p class="sub"></p>') +
      '<div class="card"><dl class="facts">' +
      (it.formula ? "<dt>화학식/CAS</dt><dd>" + esc(it.formula) + "</dd>" : "") +
      (it.conc ? "<dt>농도/순도</dt><dd>" + esc(it.conc) + "</dd>" : "") +
      (it.vol ? "<dt>용량</dt><dd>" + esc(it.vol + (it.unit || "")) + "</dd>" : "") +
      (it.maker ? "<dt>제조사</dt><dd>" + esc(it.maker) + "</dd>" : "") +
      "<dt>보관 위치</dt><dd>" + esc(doorName(it.door)) + "</dd>" +
      "</dl>" +
      '<div class="stock"><div><span>미개봉</span><b>' + it.unop + '</b>병</div><div><span>개봉</span><b>' + it.open + "</b>병</div></div>" +
      (it.warn || it.risk === "HIGH" ? '<div class="warn ' + esc(it.risk) + '"><strong>취급 주의</strong>' +
        esc(it.warn || "고위험 시약입니다. 선생님의 지도 아래에서만 사용하세요.") + "</div>" : "") +
      "</div>" +
      '<div class="btns">' + '<a class="btn primary" href="#/use/' + encodeURIComponent(it.id) + '">사용 기록하기</a>' + msdsBtns + "</div>";
    const c = document.getElementById("copyCas");
    if (c) c.addEventListener("click", function () {
      (navigator.clipboard ? navigator.clipboard.writeText(cas) : Promise.reject()).then(
        function () { toast("CAS번호를 복사했습니다. KOSHA 검색창에 붙여 넣으세요."); },
        function () { toast("CAS번호: " + cas); });
    });
  }

  /* ---------- 사용 기록 ---------- */
  async function viewUse(id) {
    loading();
    const it = (await loadItems()).find(function (x) { return x.id === id; });
    if (!it) return showError("시약을 찾지 못했습니다.");
    const t = teacher();
    if (!t && !siteKey()) {
      app.innerHTML = '<a class="crumb" href="#/item/' + encodeURIComponent(id) + '">← ' + esc(it.name) + "</a>" +
        '<div class="error-box">사용 기록은 시약장 도어에 붙은 QR 코드로 들어와야 할 수 있습니다. 도어의 QR 코드를 다시 찍어 주세요.</div>';
      return;
    }
    const units = conf.units || ["mL", "g"];
    const defUnit = units.indexOf(it.unit) >= 0 ? it.unit : (it.unit === "kg" ? "g" : units[0]);
    app.innerHTML =
      '<a class="crumb" href="#/item/' + encodeURIComponent(id) + '">← ' + esc(it.name) + "</a>" +
      "<h1>사용 기록</h1>" +
      '<p class="sub">' + esc(it.name) + (spec(it) ? " · " + esc(spec(it)) : "") + "</p>" +
      (it.risk === "HIGH" && !t ? '<div class="warn HIGH" style="margin:0 0 16px"><strong>고위험 시약</strong>기록은 선생님이 확인한 뒤에 반영됩니다.</div>' : "") +
      '<form id="f" class="card" novalidate>' +
      (t ? '<div class="field"><label>기록자</label><div><b>' + esc(t.teacher) + "</b> 선생님</div></div>" :
        '<div class="field"><label for="sid">학번</label><input id="sid" inputmode="numeric" maxlength="5" placeholder="예: 10305" autocomplete="off"><span class="hint">학년·반·번호 5자리</span></div>') +
      '<div class="field"><label for="amt">사용량</label><div class="amount"><input id="amt" type="number" inputmode="decimal" min="0" step="any" placeholder="예: 50">' +
      '<select id="unit">' + units.map(function (u) { return "<option" + (u === defUnit ? " selected" : "") + ">" + esc(u) + "</option>"; }).join("") + "</select></div></div>" +
      '<div class="field"><label for="memo">실험명 <span class="hint">(선택)</span></label><input id="memo" maxlength="100" placeholder="예: 중화 반응 실험"></div>' +
      '<label class="check"><input type="checkbox" id="waste"><div><b>폐시약병 발생</b><span>이번 사용으로 병을 다 비웠다면 체크하세요. 남은 병 수가 1병 줄어듭니다.</span></div></label>' +
      '<button class="btn primary" id="go" type="submit">기록 저장</button></form>';

    document.getElementById("f").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      const sidEl = document.getElementById("sid");
      const sid = sidEl ? sidEl.value.trim() : "";
      const amount = Number(document.getElementById("amt").value);
      if (sidEl && !/^[1-3]\d{4}$/.test(sid)) { toast("학번 5자리를 정확히 입력하세요. (예: 10305)"); sidEl.focus(); return; }
      if (!(amount > 0)) { toast("사용량을 숫자로 입력하세요."); document.getElementById("amt").focus(); return; }
      const waste = document.getElementById("waste").checked;
      if (waste && total(it) === 0) { toast("시트에 남은 병이 0병입니다. 선생님께 알려 주세요."); return; }
      const btn = document.getElementById("go");
      btn.disabled = true; btn.textContent = "저장 중…";
      const payload = { id: id, amount: amount, unit: document.getElementById("unit").value, waste: waste, memo: document.getElementById("memo").value };
      try {
        const r = t ? await api("teacherUse", Object.assign(payload, tAuth()))
          : await api("use", Object.assign(payload, { key: siteKey(), sid: sid }));
        lastResult = { item: it, res: r, waste: waste };
        items = null; // 목록 새로 받기
        location.hash = "#/done";
      } catch (e) {
        btn.disabled = false; btn.textContent = "기록 저장";
        toast(e.message);
      }
    });
  }

  function viewDone() {
    if (!lastResult) { location.hash = "#/"; return; }
    const it = lastResult.item, r = lastResult.res;
    const wait = r.state === "확인 대기";
    app.innerHTML =
      '<div class="card result' + (wait ? " wait" : "") + '">' +
      '<div class="icon">' + (wait
        ? '<svg width="30" height="30" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>'
        : '<svg width="30" height="30" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>') + "</div>" +
      "<h1>" + (wait ? "선생님 확인을 기다립니다" : "기록했습니다") + "</h1>" +
      '<p class="sub">' + esc(it.name) + " · 기록번호 " + esc(r.no) + "</p>" +
      (wait ? "<p>고위험 시약이라 선생님이 확인한 뒤에 재고에 반영됩니다. 사용한 시약은 선생님께 알려 주세요.</p>" :
        (lastResult.waste ? "<p>남은 병: 미개봉 <b>" + r.unop + "</b>병 · 개봉 <b>" + r.open + "</b>병</p>" : "")) +
      (lastResult.waste ? '<div class="notice"><b>다 쓴 병은 폐시약보관함에 넣어 주세요.</b><br>뚜껑을 닫고, 라벨이 보이게 세워 두세요.</div>' : "") +
      "</div>" +
      '<div class="btns two"><a class="btn" href="#/door/' + esc(it.door) + '">' + esc(doorName(it.door)) + '로 돌아가기</a><a class="btn" href="#/">처음으로</a></div>';
    lastResult = null;
  }

  /* =========================================================================
   * 교사 모드
   * ========================================================================= */
  async function viewTeacher(tab) {
    const t = teacher();
    if (!t) return viewLogin();
    const tabs = [["pending", "확인 대기"], ["waste", "폐시약보관함"], ["buy", "구입 등록"], ["reorder", "재구매 필요"], ["history", "최근 기록"]];
    const head = function (badge) {
      return '<div style="display:flex;justify-content:space-between;align-items:center"><h1>교사 모드</h1>' +
        '<button class="btn small" id="logout" type="button">나가기</button></div>' +
        '<nav class="tabs">' + tabs.map(function (x) {
          return '<a href="#/teacher/' + x[0] + '"' + (x[0] === tab ? ' class="on"' : "") + ">" + x[1] +
            (x[0] === "pending" && badge ? '<span class="n">' + badge + "</span>" : "") + "</a>";
        }).join("") + "</nav>";
    };
    const bindLogout = function () {
      document.getElementById("logout").addEventListener("click", function () {
        safeDel(sessionStorage, T_STORE); setTeacherLink(); location.hash = "#/";
      });
    };
    loading();
    try {
      if (tab === "pending") {
        const list = await api("pending", tAuth());
        app.innerHTML = head(list.length) + (list.length ? '<div class="pend">' + list.map(function (p) {
          return '<div class="card"><div class="who">' + esc(p.at) + " · 학번 " + esc(p.who) + " · " + esc(p.no) + "</div>" +
            "<div><b>" + esc(p.name) + "</b> " + esc(p.amount) + esc(p.unit) + (p.waste ? ' <span class="pill">폐시약병 발생</span>' : "") + "</div>" +
            (p.memo ? '<div class="who">' + esc(p.memo) + "</div>" : "") +
            '<div class="row-btns" style="margin-top:10px"><button class="btn small primary" data-no="' + esc(p.no) + '" data-ok="1">승인</button>' +
            '<button class="btn small danger" data-no="' + esc(p.no) + '" data-ok="0">반려</button></div></div>';
        }).join("") + "</div>" : '<div class="empty-state">확인을 기다리는 기록이 없습니다.</div>');
        bindLogout();
        app.querySelectorAll("[data-no]").forEach(function (b) {
          b.addEventListener("click", async function () {
            const ok = b.dataset.ok === "1";
            if (!ok && !confirm("이 기록을 반려할까요? 재고는 바뀌지 않습니다.")) return;
            b.disabled = true;
            try { await api("decide", Object.assign({ no: b.dataset.no, ok: ok }, tAuth())); toast(ok ? "승인했습니다." : "반려했습니다."); items = null; route(); }
            catch (e) { b.disabled = false; toast(e.message); }
          });
        });
      } else if (tab === "waste") {
        const w = await api("wasteBin", tAuth());
        app.innerHTML = head() +
          '<div class="card"><div class="sub" style="margin:0">폐시약보관함에 있어야 할 병 수</div><div class="big-num">' + w.total + '<span style="font-size:20px">병</span></div>' +
          (w.lastCollect ? '<div class="sub" style="margin:8px 0 0">마지막 수거: ' + esc(w.lastCollect.at) + " (" + esc(w.lastCollect.by) + ")</div>" : "") + "</div>" +
          (w.items.length ? '<div class="card"><table class="table"><thead><tr><th>시약</th><th>마지막 발생</th><th style="text-align:right">병</th></tr></thead><tbody>' +
            w.items.map(function (x) { return "<tr><td>" + esc(x.name) + '<div class="who" style="color:var(--muted);font-size:12px">' + esc(x.id) + "</div></td><td>" + esc(x.last.slice(0, 10)) + '</td><td class="num">' + x.count + "</td></tr>"; }).join("") +
            "</tbody></table></div>" : "") +
          '<form id="cf" class="card"><h2 style="margin-top:0">수거 완료 처리</h2>' +
          '<div class="field"><label for="act">실제로 확인한 병 수 <span class="hint">(선택)</span></label><input id="act" type="number" min="0" inputmode="numeric"></div>' +
          '<div class="field"><label for="cm">메모 <span class="hint">(선택)</span></label><input id="cm" maxlength="100" placeholder="예: 위탁업체 수거"></div>' +
          '<button class="btn dark" type="submit"' + (w.total ? "" : " disabled") + ">수거 완료 (보관함 0병으로)</button></form>";
        bindLogout();
        document.getElementById("cf").addEventListener("submit", async function (ev) {
          ev.preventDefault();
          if (!confirm("폐시약병 " + w.total + "병을 수거 완료로 처리할까요?")) return;
          try {
            const r = await api("collect", Object.assign({ actual: document.getElementById("act").value, memo: document.getElementById("cm").value }, tAuth()));
            toast(r.collected + "병을 수거 완료로 처리했습니다."); route();
          } catch (e) { toast(e.message); }
        });
      } else if (tab === "buy") {
        const list = await loadItems(true);
        app.innerHTML = head() +
          '<div class="card"><h2 style="margin-top:0">이미 있는 시약에 병 추가</h2>' +
          '<div class="field"><label for="bq">시약 찾기</label><input id="bq" placeholder="이름, 화학식, 제조사"></div>' +
          '<div id="bres" class="list"></div></div>' +
          '<form id="nf" class="card" novalidate><h2 style="margin-top:0">새 시약 등록</h2>' +
          '<p class="sub">목록에 없는 시약일 때만 등록하세요. 같은 시약이라도 농도·용량·제조사가 다르면 새로 등록합니다.</p>' +
          fieldIn("n_name", "시약명 *") + fieldIn("n_en", "영문명") + fieldIn("n_formula", "화학식/CAS", "예: HCl / 7647-01-0") +
          '<div class="grid2">' + fieldIn("n_conc", "농도/순도", "예: 35%") + fieldIn("n_maker", "제조사") + "</div>" +
          '<div class="field"><label for="n_vol">용량</label><div class="amount"><input id="n_vol" type="number" step="any" min="0" inputmode="decimal"><select id="n_unit">' +
          conf.units.map(function (u) { return "<option>" + esc(u) + "</option>"; }).join("") + "</select></div></div>" +
          '<div class="grid2"><div class="field"><label for="n_door">배치 도어 *</label><select id="n_door"><option value="">선택</option>' +
          conf.doors.map(function (d) { return '<option value="' + esc(d.code) + '">' + esc(d.code + " " + d.desc) + "</option>"; }).join("") + "</select></div>" +
          '<div class="field"><label for="n_risk">위험 등급 *</label><select id="n_risk"><option value="">선택</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></div></div>' +
          '<div class="field"><label for="n_warn">취급 주의사항</label><textarea id="n_warn" rows="3" maxlength="300"></textarea></div>' +
          fieldIn("n_msds", "MSDS 링크 (구글 드라이브 주소)", "https://drive.google.com/…") +
          '<div class="field"><label for="n_count">구입한 병 수 *</label><input id="n_count" type="number" min="1" value="1" inputmode="numeric"></div>' +
          '<button class="btn primary" type="submit">새 시약 등록</button></form>';
        bindLogout();
        const bq = document.getElementById("bq"), bres = document.getElementById("bres");
        const drawB = function () {
          const s = bq.value.trim().toLowerCase().replace(/\s+/g, "");
          if (!s) { bres.innerHTML = ""; return; }
          const hit = list.filter(function (it) { return [it.name, it.en, it.formula, it.maker].join(" ").toLowerCase().replace(/\s+/g, "").indexOf(s) >= 0; }).slice(0, 12);
          bres.innerHTML = hit.length ? hit.map(function (it) {
            return '<div class="card" style="padding:12px 14px"><b>' + esc(it.name) + "</b> " + '<span class="pill">' + esc(it.id) + "</span>" +
              '<div class="sub" style="margin:2px 0 8px">' + esc(spec(it)) + " · " + esc(it.door) + " · 미개봉 " + it.unop + " / 개봉 " + it.open + "</div>" +
              '<div class="row-btns"><input type="number" min="1" value="1" style="width:80px;padding:8px;border-radius:8px;border:1px solid #cfccc2" data-c="' + esc(it.id) + '">' +
              '<button class="btn small primary" type="button" data-buy="' + esc(it.id) + '">병 추가</button></div></div>';
          }).join("") : '<div class="empty-state">찾는 시약이 없습니다. 아래에서 새로 등록하세요.</div>';
          bres.querySelectorAll("[data-buy]").forEach(function (b) {
            b.addEventListener("click", async function () {
              const cnt = Number(bres.querySelector('[data-c="' + b.dataset.buy + '"]').value);
              b.disabled = true;
              try { const r = await api("purchase", Object.assign({ id: b.dataset.buy, count: cnt }, tAuth())); toast("미개봉 " + r.unop + "병이 되었습니다."); items = null; route(); }
              catch (e) { b.disabled = false; toast(e.message); }
            });
          });
        };
        bq.addEventListener("input", drawB);
        document.getElementById("nf").addEventListener("submit", async function (ev) {
          ev.preventDefault();
          const v = function (id) { return document.getElementById(id).value.trim(); };
          const item = { name: v("n_name"), en: v("n_en"), formula: v("n_formula"), conc: v("n_conc"), maker: v("n_maker"),
            vol: v("n_vol"), unit: v("n_unit"), door: v("n_door"), risk: v("n_risk"), warn: v("n_warn"), msds: v("n_msds"), count: v("n_count") };
          if (!item.name || !item.door || !item.risk) { toast("시약명, 배치 도어, 위험 등급은 꼭 입력하세요."); return; }
          if (item.msds && !/^https:\/\//i.test(item.msds)) { toast("MSDS 링크는 https:// 로 시작하는 주소여야 합니다."); return; }
          try { const r = await api("newItem", Object.assign({ item: item }, tAuth())); toast(r.id + "로 등록했습니다."); items = null; location.hash = "#/item/" + r.id; }
          catch (e) { toast(e.message); }
        });
      } else if (tab === "reorder") {
        const list = (await loadItems(true)).filter(function (it) { return total(it) === 0 || it.status === "재구매 필요"; });
        const low = (await loadItems()).filter(function (it) { return total(it) > 0 && it.unop === 0; });
        app.innerHTML = head() +
          "<h2>남은 병이 없는 시약 (" + list.length + ")</h2>" +
          (list.length ? '<div class="list">' + list.map(itemRow).join("") + "</div>" : '<div class="empty-state">없습니다.</div>') +
          "<h2>새 병이 없는 시약 (" + low.length + ")</h2><p class=\"sub\">개봉 병만 남아 있어 곧 떨어질 수 있습니다.</p>" +
          (low.length ? '<div class="list">' + low.map(itemRow).join("") + "</div>" : '<div class="empty-state">없습니다.</div>');
        bindLogout();
      } else {
        const h = await api("history", Object.assign({ limit: 60 }, tAuth()));
        app.innerHTML = head() + (h.length ? '<div class="card" style="padding:6px 12px;overflow-x:auto"><table class="table"><thead><tr><th>일시</th><th>기록자</th><th>시약</th><th>내용</th><th>상태</th></tr></thead><tbody>' +
          h.map(function (x) {
            return "<tr><td>" + esc(x.at.slice(5, 16)) + "</td><td>" + esc(x.who) + "</td><td>" + esc(x.name) + "</td><td>" + esc(x.type) + " " + esc(x.amount) + esc(x.unit) +
              (x.waste ? " · 폐시약병" : "") + "</td><td>" + esc(x.state) + "</td></tr>";
          }).join("") + "</tbody></table></div>" : '<div class="empty-state">기록이 없습니다.</div>');
        bindLogout();
      }
    } catch (e) {
      if (/비밀번호|교사 이름/.test(e.message)) { safeDel(sessionStorage, T_STORE); setTeacherLink(); }
      showError(e.message);
    }
  }

  function fieldIn(id, label, ph) {
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label><input id="' + id + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : "") + "></div>";
  }

  function viewLogin() {
    const names = conf.teachers || [];
    app.innerHTML = "<h1>교사 모드</h1>" +
      '<p class="sub">고위험 시약 확인, 폐시약보관함 관리, 구입 등록을 할 수 있습니다.</p>' +
      '<form id="lf" class="card"><div class="field"><label for="tn">이름</label><select id="tn"><option value="">선택</option>' +
      names.map(function (n) { return "<option>" + esc(n) + "</option>"; }).join("") + "</select></div>" +
      '<div class="field"><label for="tp">비밀번호</label><input id="tp" type="password" autocomplete="current-password"></div>' +
      '<button class="btn dark" type="submit">들어가기</button></form>' +
      (names.length ? "" : '<p class="sub" style="margin-top:12px">교사 이름 목록이 비어 있습니다. 스크립트 속성 TEACHER_NAMES를 설정하세요.</p>');
    document.getElementById("lf").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      const cred = { teacher: document.getElementById("tn").value, pw: document.getElementById("tp").value };
      if (!cred.teacher || !cred.pw) { toast("이름과 비밀번호를 입력하세요."); return; }
      try {
        await api("login", cred);
        safeSet(sessionStorage, T_STORE, JSON.stringify(cred));
        setTeacherLink(); route();
      } catch (e) { toast(e.message); }
    });
  }

  route();
})();
