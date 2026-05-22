const SUPABASE_URL = window.INVENTORY_SUPABASE?.url || "";
const SUPABASE_ANON_KEY = window.INVENTORY_SUPABASE?.anonKey || "";
const ROOM_RETENTION_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BARCODE_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"];

const state = {
  roomId: "",
  userName: "",
  deviceId: "",
  roomCreatedAt: "",
  editingCountId: "",
  products: [],
  countEntries: [],
  reviewSearch: "",
  diffOnly: false,
  updatedAt: "",
  pollTimer: null,
  saving: false,
  hasUnsyncedChanges: false,
  pendingDeletedProductJans: [],
  roomExpiryAvailable: true,
  setupLocked: true,
  continuousScanning: false,
  continuousScanStream: null,
  continuousScanDetector: null,
  continuousZxingReader: null,
  continuousReadQueue: 0,
  continuousReadProcessing: false,
  continuousReadCount: 0,
  continuousCandidateCode: "",
  continuousCandidateHits: 0,
  continuousStableCode: "",
  continuousStableAt: 0,
  continuousBarcodeDetectorRunning: false,
  continuousZxingRunning: false
};

const $ = (selector) => document.querySelector(selector);
const localKey = (roomId) => `inventory-room:${roomId}`;
const deviceKey = "inventory-device-id";
const userKey = "inventory-user-name";
const cloudReady = () => SUPABASE_URL.trim() && SUPABASE_ANON_KEY.trim();

const elements = {
  lockScreen: $("#lockScreen"),
  appShell: $("#appShell"),
  cloudSetupNotice: $("#cloudSetupNotice"),
  createRoom: $("#createRoom"),
  joinForm: $("#joinForm"),
  userName: $("#userName"),
  roomCode: $("#roomCode"),
  activeRoomCode: $("#activeRoomCode"),
  activeUserName: $("#activeUserName"),
  syncStatus: $("#syncStatus"),
  copyInvite: $("#copyInvite"),
  logout: $("#logout"),
  tabs: document.querySelectorAll(".tab"),
  panels: document.querySelectorAll(".tab-panel"),
  productForm: $("#productForm"),
  productJan: $("#productJan"),
  productName: $("#productName"),
  expectedQty: $("#expectedQty"),
  productScanButton: $("#productScanButton"),
  productScanMessage: $("#productScanMessage"),
  productScannerPreview: $("#productScannerPreview"),
  productRows: $("#productRows"),
  productTotal: $("#productTotal"),
  csvImport: $("#csvImport"),
  csvImportButton: $("#csvImportButton"),
  setupLockStatus: $("#setupLockStatus"),
  setupLockToggle: $("#setupLockToggle"),
  countForm: $("#countForm"),
  countSearch: $("#countSearch"),
  shelfNo: $("#shelfNo"),
  countQty: $("#countQty"),
  countSubmit: $("#countSubmit"),
  takeoverEntryButton: $("#takeoverEntryButton"),
  productHints: $("#productHints"),
  countRows: $("#countRows"),
  countTotal: $("#countTotal"),
  selectedProduct: $("#selectedProduct"),
  reviewRows: $("#reviewRows"),
  reviewSearch: $("#reviewSearch"),
  diffOnly: $("#diffOnly"),
  exportRows: $("#exportRows"),
  matchTotal: $("#matchTotal"),
  shortTotal: $("#shortTotal"),
  overTotal: $("#overTotal"),
  exportCsv: $("#exportCsv"),
  scanButton: $("#scanButton"),
  continuousScanButton: $("#continuousScanButton"),
  continuousScannerStage: $("#continuousScannerStage"),
  continuousScanControls: $("#continuousScanControls"),
  continuousReadButton: $("#continuousReadButton"),
  continuousStopButton: $("#continuousStopButton"),
  scanMessage: $("#scanMessage"),
  countScannerPreview: $("#countScannerPreview"),
  scannerPreview: $("#scannerPreview")
};

function normalizeRoom(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeShelf(value) {
  const shelf = String(value || "").trim().replace(/\s+/g, "").slice(0, 20);
  return /^\d{1,3}$/.test(shelf) ? shelf.padStart(3, "0") : shelf;
}

function normalizeJan(value) {
  return String(value || "").trim();
}

function isNumericCode(value) {
  return /^\d+$/.test(normalizeJan(value));
}

function toInt(value) {
  const number = Number.parseInt(String(value ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function expiryCutoff() {
  return new Date(Date.now() - ROOM_RETENTION_DAYS * MS_PER_DAY).toISOString();
}

function expiresAt(createdAt) {
  const createdTime = Date.parse(createdAt);
  return Number.isFinite(createdTime) ? new Date(createdTime + ROOM_RETENTION_DAYS * MS_PER_DAY) : null;
}

function isExpired(createdAt) {
  const expiry = expiresAt(createdAt);
  return Boolean(expiry && expiry.getTime() <= Date.now());
}

function formatDateTime(date) {
  return date ? date.toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" }) : "";
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(values, (value) => chars[value % chars.length]).join("");
}

function getDeviceId() {
  let id = localStorage.getItem(deviceKey);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(deviceKey, id);
  }
  return id;
}

function makeEntryId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${state.deviceId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function payload() {
  return {
    roomCreatedAt: state.roomCreatedAt,
    products: state.products,
    countEntries: state.countEntries,
    hasUnsyncedChanges: state.hasUnsyncedChanges,
    pendingDeletedProductJans: state.pendingDeletedProductJans,
    updatedAt: state.updatedAt
  };
}

function applyPayload(data) {
  state.products = Array.isArray(data.products) ? data.products : [];
  if (Array.isArray(data.countEntries)) {
    state.countEntries = data.countEntries;
  } else if (data.counts && typeof data.counts === "object") {
    state.countEntries = Object.entries(data.counts).map(([jan, qty]) => ({
      id: `legacy-${jan}`,
      deviceId: "legacy",
      userName: "旧データ",
      jan,
      shelfNo: "000",
      qty: toInt(qty),
      createdAt: data.updatedAt || new Date().toISOString()
    })).filter((entry) => entry.qty > 0);
  } else {
    state.countEntries = [];
  }
  state.roomCreatedAt = data.roomCreatedAt || state.roomCreatedAt || "";
  state.hasUnsyncedChanges = Boolean(data.hasUnsyncedChanges);
  state.pendingDeletedProductJans = Array.isArray(data.pendingDeletedProductJans) ? data.pendingDeletedProductJans : [];
  state.updatedAt = data.updatedAt || "";
}

function setSyncStatus(text, tone = "muted") {
  elements.syncStatus.textContent = text;
  elements.syncStatus.className = `pill ${tone}`;
}

async function tryCloud(operation) {
  try {
    const hadUnsyncedChanges = state.hasUnsyncedChanges;
    await operation();
    if (hadUnsyncedChanges) await pushCloudState();
    await syncPendingProductDeletes();
    state.hasUnsyncedChanges = false;
    if (cloudReady()) setSyncStatus("同期済み", "ok");
    return true;
  } catch (error) {
    console.error("Inventory sync failed", error);
    state.hasUnsyncedChanges = true;
    setSyncStatus(`端末に保存済み・同期失敗: ${error.message}`, "danger");
    return false;
  }
}

function setSetupLocked(locked) {
  state.setupLocked = locked;
  elements.setupLockStatus.textContent = locked ? "設定ロック中" : "設定を変更できます";
  elements.setupLockToggle.textContent = locked ? "ロック解除" : "ロックする";
  elements.setupLockToggle.setAttribute("aria-pressed", String(!locked));
  elements.productForm.querySelectorAll("input, button").forEach((control) => {
    control.disabled = locked;
  });
  elements.csvImport.disabled = locked;
  elements.csvImportButton.classList.toggle("disabled", locked);
  elements.csvImportButton.setAttribute("aria-disabled", String(locked));
}

function saveLocal() {
  if (!state.roomId) return;
  localStorage.setItem(localKey(state.roomId), JSON.stringify(payload()));
}

function loadLocal(roomId) {
  const saved = JSON.parse(localStorage.getItem(localKey(roomId)) || "{}");
  applyPayload(saved);
  if (!state.roomCreatedAt) {
    state.roomCreatedAt = new Date().toISOString();
    saveLocal();
  }
}

function pruneExpiredLocalRooms() {
  Object.keys(localStorage)
    .filter((key) => key.startsWith("inventory-room:"))
    .forEach((key) => {
      try {
        const data = JSON.parse(localStorage.getItem(key) || "{}");
        const createdAt = data.roomCreatedAt || data.updatedAt;
        if (isExpired(createdAt)) localStorage.removeItem(key);
      } catch (error) {
        localStorage.removeItem(key);
      }
    });
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    ...extra
  };
}

function tableEndpoint(table, query = "") {
  return `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}${query}`;
}

function isMissingRoomCreatedAt(error) {
  return String(error?.message || "").includes("inventory_rooms.created_at does not exist");
}

async function requestSupabase(table, query = "", options = {}) {
  const response = await fetch(tableEndpoint(table, query), {
    ...options,
    headers: supabaseHeaders(options.headers || {})
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const error = JSON.parse(text);
      detail = error.message || error.details || error.hint || text;
    } catch (parseError) {
      detail = text;
    }
    throw new Error(`${table} ${response.status}: ${detail || response.statusText}`);
  }
  if (response.status === 204) return null;
  return text ? JSON.parse(text) : null;
}

async function ensureCloudRoom() {
  if (!cloudReady() || !state.roomId) return;
  try {
    const created = await requestSupabase("inventory_rooms", "?on_conflict=id&select=id,created_at", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ id: state.roomId })
    });
    if (created?.[0]?.created_at) {
      state.roomCreatedAt = created[0].created_at;
      saveLocal();
    }
  } catch (error) {
    if (!isMissingRoomCreatedAt(error)) throw error;
    state.roomExpiryAvailable = false;
    await requestSupabase("inventory_rooms", "?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ id: state.roomId })
    });
  }
}

async function deleteExpiredCloudRooms() {
  if (!cloudReady() || !state.roomExpiryAvailable) return;
  try {
    await requestSupabase("inventory_rooms", `?created_at=lt.${encodeURIComponent(expiryCutoff())}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
  } catch (error) {
    if (!isMissingRoomCreatedAt(error)) throw error;
    state.roomExpiryAvailable = false;
  }
}

async function deleteCloudRoom(roomId = state.roomId) {
  if (!cloudReady() || !roomId) return;
  await requestSupabase("inventory_rooms", `?id=eq.${encodeURIComponent(roomId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
}

async function closeExpiredRoom() {
  const expiredRoomId = state.roomId;
  if (!expiredRoomId) return;
  clearInterval(state.pollTimer);
  await deleteCloudRoom(expiredRoomId).catch(() => null);
  localStorage.removeItem(localKey(expiredRoomId));
  state.roomId = "";
  state.roomCreatedAt = "";
  elements.lockScreen.hidden = false;
  elements.appShell.hidden = true;
  history.replaceState(null, "", location.pathname);
  window.alert(`作成から${ROOM_RETENTION_DAYS}日経過したため、部屋を削除しました。`);
}

async function fetchCloudState(roomId) {
  if (!cloudReady()) return null;
  const roomFilter = `room_id=eq.${encodeURIComponent(roomId)}`;
  const [products, entries] = await Promise.all([
    requestSupabase("inventory_products", `?${roomFilter}&select=jan,name,expected&order=name.asc`),
    requestSupabase("inventory_count_entries", `?${roomFilter}&select=id,device_id,user_name,jan,shelf_no,qty,created_at,updated_at&order=created_at.desc`)
  ]);
  return {
    products: (products || []).map((product) => ({
      jan: product.jan,
      name: product.name,
      expected: toInt(product.expected)
    })),
    countEntries: (entries || []).map((entry) => ({
      id: entry.id,
      deviceId: entry.device_id,
      userName: entry.user_name,
      jan: entry.jan,
      shelfNo: entry.shelf_no,
      qty: toInt(entry.qty),
      createdAt: entry.created_at,
      updatedAt: entry.updated_at
    })),
    updatedAt: new Date().toISOString()
  };
}

async function saveCloudProduct(product) {
  if (!cloudReady() || !state.roomId) return;
  await ensureCloudRoom();
  await requestSupabase("inventory_products", "?on_conflict=room_id,jan", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      room_id: state.roomId,
      jan: product.jan,
      name: product.name,
      expected: product.expected
    })
  });
}

async function deleteCloudProduct(jan) {
  if (!cloudReady() || !state.roomId) return;
  const query = `?room_id=eq.${encodeURIComponent(state.roomId)}&jan=eq.${encodeURIComponent(jan)}`;
  await Promise.all([
    requestSupabase("inventory_products", query, { method: "DELETE", headers: { Prefer: "return=minimal" } }),
    requestSupabase("inventory_count_entries", query, { method: "DELETE", headers: { Prefer: "return=minimal" } })
  ]);
}

async function saveCloudEntry(entry) {
  if (!cloudReady() || !state.roomId) return;
  await ensureCloudRoom();
  await requestSupabase("inventory_count_entries", "?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      id: entry.id,
      room_id: state.roomId,
      device_id: entry.deviceId,
      user_name: entry.userName,
      jan: entry.jan,
      shelf_no: entry.shelfNo,
      qty: toInt(entry.qty),
      updated_at: new Date().toISOString()
    })
  });
}

async function deleteCloudEntry(entryId) {
  if (!cloudReady() || !state.roomId) return;
  await requestSupabase("inventory_count_entries", `?id=eq.${encodeURIComponent(entryId)}&device_id=eq.${encodeURIComponent(state.deviceId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
}

async function saveCloudProducts(products) {
  if (!cloudReady() || !state.roomId || !products.length) return;
  await ensureCloudRoom();
  await requestSupabase("inventory_products", "?on_conflict=room_id,jan", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(products.map((product) => ({
      room_id: state.roomId,
      jan: product.jan,
      name: product.name,
      expected: product.expected
    })))
  });
}

async function pushCloudState() {
  if (!cloudReady() || !state.roomId) return;
  await ensureCloudRoom();
  await saveCloudProducts(state.products);
  await Promise.all(state.countEntries
    .filter((entry) => toInt(entry.qty) > 0)
    .map((entry) => saveCloudEntry(entry)));
}

async function syncPendingProductDeletes() {
  if (!cloudReady() || !state.roomId || !state.pendingDeletedProductJans.length) return;
  const deleting = [...state.pendingDeletedProductJans];
  for (const jan of deleting) {
    await deleteCloudProduct(jan);
    state.pendingDeletedProductJans = state.pendingDeletedProductJans.filter((item) => item !== jan);
    saveLocal();
  }
}

async function pullCloudRoom({ renderAfter = true } = {}) {
  if (!cloudReady() || !state.roomId) return;
  try {
    if (isExpired(state.roomCreatedAt)) {
      await closeExpiredRoom();
      return;
    }
    if (state.hasUnsyncedChanges) {
      setSyncStatus("端末に保存済み・同期待ち", "danger");
      return;
    }
    await ensureCloudRoom();
    const incoming = await fetchCloudState(state.roomId);
    applyPayload(incoming);
    saveLocal();
    if (renderAfter) render(false);
    setSyncStatus("同期済み", "ok");
  } catch (error) {
    console.error("Inventory pull failed", error);
    setSyncStatus(`同期失敗: ${error.message}`, "danger");
  }
}

async function persist() {
  state.updatedAt = new Date().toISOString();
  saveLocal();
}

function startPolling() {
  clearInterval(state.pollTimer);
  if (!cloudReady()) {
    setSyncStatus("クラウド未設定", "danger");
    return;
  }
  state.pollTimer = setInterval(() => pullCloudRoom(), 3000);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function findProduct(query) {
  const term = normalizeJan(query).toLowerCase();
  return state.products.find((product) => (
    product.jan.toLowerCase() === term ||
    product.name.toLowerCase() === term ||
    `${product.jan} ${product.name}`.toLowerCase() === term
  ));
}

function countsByJan(entries = state.countEntries) {
  return entries.reduce((totals, entry) => {
    totals[entry.jan] = (totals[entry.jan] || 0) + toInt(entry.qty);
    return totals;
  }, {});
}

function breakdownByJan(entries = state.countEntries) {
  return entries.reduce((groups, entry) => {
    const jan = entry.jan;
    const shelf = entry.shelfNo || "000";
    const user = entry.userName || "担当未設定";
    groups[jan] ||= {};
    groups[jan][shelf] ||= {};
    groups[jan][shelf][user] = (groups[jan][shelf][user] || 0) + toInt(entry.qty);
    return groups;
  }, {});
}

function render(push = true) {
  renderProducts();
  renderCounts();
  renderReview();
  renderExportRows();
  setSetupLocked(state.setupLocked);
  if (push) persist();
}

function renderProducts() {
  const lockedAttribute = state.setupLocked ? " disabled" : "";
  elements.productTotal.textContent = `${state.products.length}件`;
  elements.productHints.innerHTML = state.products
    .map((product) => `<option value="${escapeHtml(product.jan)}">${escapeHtml(product.name)}</option>`)
    .join("");

  if (!state.products.length) {
    elements.productRows.innerHTML = `<tr><td class="empty" colspan="4">商品を登録してください。</td></tr>`;
    return;
  }

  elements.productRows.innerHTML = state.products.map((product) => `
    <tr>
      <td>${escapeHtml(product.jan)}</td>
      <td>${escapeHtml(product.name)}</td>
      <td class="num">${product.expected}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="ghost" data-edit="${escapeHtml(product.jan)}"${lockedAttribute}>編集</button>
          <button type="button" class="danger" data-delete-product="${escapeHtml(product.jan)}"${lockedAttribute}>削除</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderCounts() {
  const entries = state.countEntries
    .filter((entry) => entry.deviceId === state.deviceId && toInt(entry.qty) > 0)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const total = entries.reduce((sum, entry) => sum + toInt(entry.qty), 0);
  elements.countTotal.textContent = `${total}点`;

  if (!entries.length) {
    elements.countRows.innerHTML = `<tr><td class="empty" colspan="6">この端末で入力した数量はまだありません。</td></tr>`;
    return;
  }

  elements.countRows.innerHTML = entries.map((entry) => {
    const product = state.products.find((item) => item.jan === entry.jan) || { name: "未登録商品" };
    return `
      <tr>
        <td>${escapeHtml(entry.shelfNo || "000")}</td>
        <td>${escapeHtml(entry.jan)}</td>
        <td>${escapeHtml(product.name)}</td>
        <td class="num">${toInt(entry.qty)}</td>
        <td>${escapeHtml(entry.userName || state.userName)}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="ghost" data-edit-entry="${escapeHtml(entry.id)}">編集</button>
            <button type="button" class="ghost" data-minus-entry="${escapeHtml(entry.id)}">-1</button>
            <button type="button" class="danger" data-delete-entry="${escapeHtml(entry.id)}">削除</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function takeoverEntry(entry) {
  const previousUser = entry.userName || "担当未設定";
  const product = state.products.find((item) => item.jan === entry.jan) || { name: "未登録商品" };
  const ok = window.confirm(
    `${previousUser}さんの入力を${state.userName}さんに引き継ぎます。\n` +
    `棚番: ${entry.shelfNo || "000"}\n` +
    `商品: ${product.name}\n` +
    `数量: ${toInt(entry.qty)}\n\nよろしいですか？`
  );
  if (!ok) return false;
  entry.deviceId = state.deviceId;
  entry.userName = state.userName;
  entry.updatedAt = new Date().toISOString();
  return true;
}

function renderReview() {
  let matches = 0;
  let shorts = 0;
  let overs = 0;
  const knownJans = new Set(state.products.map((product) => product.jan));
  const totals = countsByJan();
  const breakdown = breakdownByJan();
  const reviewItems = state.products.map((product) => {
    const counted = totals[product.jan] || 0;
    const diff = counted - product.expected;
    if (diff === 0) matches += 1;
    if (diff < 0) shorts += 1;
    if (diff > 0) overs += 1;
    return { jan: product.jan, name: product.name, expected: product.expected, counted, diff, shelves: breakdown[product.jan] };
  });

  Object.entries(totals).forEach(([jan, counted]) => {
    if (!knownJans.has(jan) && counted > 0) {
      overs += 1;
      reviewItems.push({ jan, name: "未登録商品", expected: 0, counted, diff: counted, shelves: breakdown[jan] });
    }
  });

  const search = normalizeCsvHeader(state.reviewSearch);
  const rows = reviewItems
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.jan.localeCompare(b.jan, "ja", { numeric: true }))
    .filter((item) => !state.diffOnly || item.diff !== 0)
    .filter((item) => {
      if (!search) return true;
      return normalizeCsvHeader(item.jan).includes(search) ||
        normalizeCsvHeader(item.name).includes(search) ||
        normalizeCsvHeader(usersText(item.shelves)).includes(search);
    })
    .map((item) => reviewRow(item.jan, item.name, item.expected, item.counted, item.diff, item.shelves));

  elements.matchTotal.textContent = `一致 ${matches}`;
  elements.shortTotal.textContent = `不足 ${shorts}`;
  elements.overTotal.textContent = `過剰 ${overs}`;
  elements.reviewRows.innerHTML = rows.length
    ? rows.join("")
    : `<tr><td class="empty" colspan="6">確認する商品がありません。</td></tr>`;
}

function usersText(shelves = {}) {
  return Object.values(shelves)
    .flatMap((users) => Object.keys(users))
    .join(" ");
}

function reviewRow(jan, name, expected, counted, diff, shelves = {}) {
  const className = diff === 0 ? "" : diff < 0 ? "danger" : "status";
  const label = diff > 0 ? `+${diff}` : diff;
  const detail = Object.entries(shelves).length
    ? Object.entries(shelves)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([shelf, users]) => {
        const userText = Object.entries(users)
          .sort(([a], [b]) => a.localeCompare(b, "ja"))
          .map(([user, qty]) => `${escapeHtml(user)} ${qty}`)
          .join(" / ");
        const shelfTotal = Object.values(users).reduce((sum, qty) => sum + qty, 0);
        return `<span class="breakdown-item">棚${escapeHtml(shelf)}: ${shelfTotal}個 (${userText})</span>`;
      })
      .join("")
    : `<span class="muted-text">入力なし</span>`;
  return `
    <tr>
      <td>${escapeHtml(jan)}</td>
      <td>${escapeHtml(name)}</td>
      <td class="num">${expected}</td>
      <td class="num">${counted}</td>
      <td class="num"><span class="${className}">${label}</span></td>
      <td><div class="breakdown-list">${detail}</div></td>
    </tr>
  `;
}

function shelfMemo(shelves = {}) {
  return Object.entries(shelves)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([shelf, users]) => {
      const shelfTotal = Object.values(users).reduce((sum, qty) => sum + toInt(qty), 0);
      return `棚${shelf}: ${shelfTotal}`;
    })
    .join(" / ");
}

function exportRowsData() {
  const totals = countsByJan();
  const breakdown = breakdownByJan();
  const knownJans = new Set(state.products.map((product) => product.jan));
  const extraJans = Object.keys(totals).filter((jan) => !knownJans.has(jan));

  return [...state.products.map((product) => product.jan), ...extraJans]
    .map((jan) => ({
      code: jan,
      qty: totals[jan] || 0,
      memo: shelfMemo(breakdown[jan])
    }))
    .sort((a, b) => a.code.localeCompare(b.code, "ja", { numeric: true }));
}

function renderExportRows() {
  const rows = exportRowsData();
  elements.exportRows.innerHTML = rows.length
    ? rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.code)}</td>
        <td class="num">${row.qty}</td>
        <td>${escapeHtml(row.memo)}</td>
      </tr>
    `).join("")
    : `<tr><td class="empty" colspan="3">出力する商品がありません。</td></tr>`;
}

function upsertProduct(product) {
  const productName = String(product.name || "").trim();
  const sameNameIndex = state.products.findIndex((item) => (
    item.jan !== product.jan &&
    sameProductName(item.name, productName) &&
    (isFallbackJan(item.jan) || isFallbackJan(product.jan))
  ));
  if (sameNameIndex >= 0) {
    const existing = state.products[sameNameIndex];
    const merged = {
      jan: isFallbackJan(product.jan) && !isFallbackJan(existing.jan) ? existing.jan : product.jan,
      name: productName || existing.name,
      expected: product.expected
    };
    mergeEntryJan(existing.jan, merged.jan);
    state.products.splice(sameNameIndex, 1);
    const duplicateIndex = state.products.findIndex((item) => item.jan === merged.jan);
    if (duplicateIndex >= 0) {
      state.products[duplicateIndex] = {
        ...state.products[duplicateIndex],
        name: merged.name || state.products[duplicateIndex].name,
        expected: merged.expected
      };
    } else {
      state.products.push(merged);
    }
    state.products.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    return;
  }

  const index = state.products.findIndex((item) => item.jan === product.jan);
  if (index >= 0) {
    const existing = state.products[index];
    state.products[index] = {
      ...product,
      name: productName && existing.name === existing.jan ? productName : product.name
    };
  } else {
    state.products.push(product);
  }
  state.products.sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text || "").replace(/^\ufeff/, "");

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (char === "\"") {
      if (quoted && next === "\"") {
        cell += "\"";
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function normalizeCsvHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function findCsvColumn(headers, names) {
  const normalized = names.map(normalizeCsvHeader);
  return headers.findIndex((header) => normalized.includes(normalizeCsvHeader(header)));
}

function findCsvColumnWhere(headers, names, predicate) {
  const normalized = names.map(normalizeCsvHeader);
  return headers.findIndex((header) => normalized.includes(normalizeCsvHeader(header)) && predicate(header));
}

function isMoneyHeader(value) {
  return /金額|価格|単価|原価|売価|販売|税|price|amount|cost|yen|円/i.test(String(value || ""));
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function codeCellScore(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const digits = digitsOnly(text);
  if ([8, 12, 13, 14].includes(digits.length)) return 5;
  if (/^\d+$/.test(text) && digits.length >= 5 && digits.length <= 20) return 3;
  if (/^[A-Z0-9_-]{4,}$/i.test(text) && /\d/.test(text)) return 1;
  return 0;
}

function textCellScore(value) {
  const text = String(value || "").trim();
  if (!text || codeCellScore(text) >= 3) return 0;
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}A-Za-z]/u.test(text)) return Math.min(text.length, 30);
  return 0;
}

function guessCsvColumn(rows, scorer, excluded = new Set()) {
  let bestIndex = -1;
  let bestScore = 0;
  const width = Math.max(0, ...rows.map((row) => row.length));
  for (let index = 0; index < width; index += 1) {
    if (excluded.has(index)) continue;
    const score = rows.reduce((sum, row) => sum + scorer(row[index]), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestScore > 0 ? bestIndex : -1;
}

function extractCombinedProductCell(value) {
  const text = String(value || "").trim();
  if (!text) return { code: "", name: "" };
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates = [...text.matchAll(/[0-9]{4,20}/g)]
    .map((match) => match[0])
    .sort((a, b) => codeCellScore(b) - codeCellScore(a) || b.length - a.length);
  const code = candidates[0] || "";
  const nameLine = lines.find((line) => textCellScore(line) > 0 && !line.includes(code)) ||
    lines.find((line) => textCellScore(line) > 0) ||
    "";
  const name = code ? nameLine.replace(code, "").replace(/^[\s\-/:：・|]+|[\s\-/:：・|]+$/g, "").trim() : nameLine;
  return { code, name };
}

function fallbackJanFromName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) >>> 0;
  }
  return `NOJAN-${hash.toString(36).toUpperCase()}`;
}

function isFallbackJan(jan) {
  return String(jan || "").startsWith("NOJAN-");
}

function sameProductName(a, b) {
  return normalizeCsvHeader(a) && normalizeCsvHeader(a) === normalizeCsvHeader(b);
}

function mergeEntryJan(fromJan, toJan) {
  if (!fromJan || !toJan || fromJan === toJan) return;
  state.countEntries.forEach((entry) => {
    if (entry.jan === fromJan) {
      entry.jan = toJan;
      entry.updatedAt = new Date().toISOString();
    }
  });
  if (!state.pendingDeletedProductJans.includes(fromJan)) {
    state.pendingDeletedProductJans.push(fromJan);
  }
  state.hasUnsyncedChanges = true;
}

function parseCsv(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];

  const headers = rows.shift();
  const headerJanIndex = findCsvColumn(headers, [
    "jan",
    "janコード",
    "jancode",
    "barcode",
    "bar_code",
    "code",
    "sku",
    "plu",
    "コード",
    "バーコード",
    "商品コード",
    "商品cd",
    "商品ｃｄ",
    "品番",
    "品目コード",
    "品目cd",
    "品コード",
    "管理コード"
  ]);
  const headerNameIndex = findCsvColumn(headers, [
    "name",
    "product",
    "item",
    "description",
    "title",
    "商品名",
    "商品名称",
    "品名",
    "品目名",
    "品目",
    "名称",
    "商品",
    "商品情報",
    "商品id商品コード商品名",
    "商品id/商品コード/商品名",
    "明細名",
    "内容"
  ]);
  const expectedIndex = findCsvColumnWhere(headers, [
    "expected",
    "stock",
    "qty",
    "quantity",
    "count",
    "予定数",
    "理論在庫",
    "在庫数",
    "帳簿在庫",
    "個数",
    "数量",
    "数",
    "在庫",
    "現在庫",
    "総数"
  ], (header) => !isMoneyHeader(header));
  const headerLooksLikeData = headerJanIndex < 0 && headerNameIndex < 0 && headers.some((cell) => codeCellScore(cell) >= 3);
  const dataRows = headerLooksLikeData ? [headers, ...rows] : rows;
  const janIndex = headerJanIndex >= 0 ? headerJanIndex : guessCsvColumn(dataRows, codeCellScore);
  const nameIndex = headerNameIndex >= 0 ? headerNameIndex : guessCsvColumn(dataRows, textCellScore, new Set([janIndex]));
  const productByJan = new Map(state.products.map((product) => [product.jan, product]));
  const productByName = new Map(state.products.map((product) => [normalizeCsvHeader(product.name), product]));

  if (janIndex < 0 && nameIndex < 0) return [];

  return dataRows.map((row) => {
    const janCell = janIndex >= 0 ? normalizeJan(row[janIndex]) : "";
    const nameCell = nameIndex >= 0 ? String(row[nameIndex] || "").trim() : "";
    const combined = extractCombinedProductCell(`${janCell}\n${nameCell}`);
    const rawJan = janCell && codeCellScore(janCell) >= 1 ? janCell : combined.code;
    const rawName = nameCell && textCellScore(nameCell) > 0 ? (combined.name || nameCell) : combined.name;
    const existing = productByJan.get(rawJan) || productByName.get(normalizeCsvHeader(rawName));
    const jan = rawJan || existing?.jan || (rawName ? fallbackJanFromName(rawName) : "");
    const name = rawName || existing?.name || rawJan;
    const expected = expectedIndex >= 0 && row[expectedIndex] !== ""
      ? toInt(row[expectedIndex])
      : existing?.expected || 0;
    return { jan, name, expected };
  }).filter((product) => product.jan && product.name);
}

async function downloadCsv() {
  await pullCloudRoom({ renderAfter: false });
  const header = ["商品コード", "棚卸数量", "明細メモ"];
  const csv = [header, ...exportRowsData().map((row) => [row.code, row.qty, row.memo])]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `inventory-${state.roomId}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function showScanMessage(messageEl, message) {
  messageEl.hidden = false;
  messageEl.textContent = message;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeScannedCode(code) {
  const value = String(code || "").trim();
  const digits = digitsOnly(value);
  if ([8, 12, 13, 14].includes(digits.length)) return digits;
  return value;
}

function pickBestBarcode(codes) {
  const preferredFormats = ["ean_13", "ean_8", "upc_a", "upc_e"];
  const candidates = [...codes].sort((a, b) => {
    const aFormat = preferredFormats.includes(String(a.format || "").toLowerCase()) ? 1 : 0;
    const bFormat = preferredFormats.includes(String(b.format || "").toLowerCase()) ? 1 : 0;
    return bFormat - aFormat || digitsOnly(b.rawValue).length - digitsOnly(a.rawValue).length;
  });
  return normalizeScannedCode(candidates[0]?.rawValue);
}

function cameraConstraints() {
  return {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      focusMode: { ideal: "continuous" },
      frameRate: { ideal: 30, max: 60 }
    }
  };
}

async function prepareScannerStream(previewEl) {
  const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
  previewEl.srcObject = stream;
  await new Promise((resolve) => {
    if (previewEl.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
      return;
    }
    previewEl.onloadedmetadata = resolve;
  });
  await previewEl.play();

  const track = stream.getVideoTracks()[0];
  const capabilities = track?.getCapabilities?.() || {};
  const advanced = [];
  if (capabilities.focusMode?.includes?.("continuous")) advanced.push({ focusMode: "continuous" });
  if (capabilities.torch) advanced.push({ torch: true });
  if (advanced.length) {
    track.applyConstraints({ advanced }).catch(() => null);
  }
  return stream;
}

async function scanWithBarcodeDetector(previewEl, timeoutMs = 4500) {
  if (!("BarcodeDetector" in window)) return "";
  const detector = new BarcodeDetector({ formats: BARCODE_FORMATS });
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const codes = await detector.detect(previewEl);
      if (codes.length) return pickBestBarcode(codes);
      const canvasCode = await detectBarcodeFromCanvas(previewEl, detector, 1);
      if (canvasCode) return canvasCode;
    } catch (error) {
      return "";
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return "";
}

async function detectBarcodeFromPreview(previewEl, detector, tries = 4) {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const codes = await detector.detect(previewEl);
    if (codes.length) return pickBestBarcode(codes);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return "";
}

async function detectBarcodeFromCanvas(previewEl, detector, tries = 3) {
  const canvas = document.createElement("canvas");
  const width = previewEl.videoWidth || 1280;
  const height = previewEl.videoHeight || 720;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      context.drawImage(previewEl, 0, 0, width, height);
      const codes = await detector.detect(canvas);
      if (codes.length) return pickBestBarcode(codes);
    } catch (error) {
      return "";
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return "";
}

async function detectContinuousCodeWithBarcodeDetector() {
  const detector = state.continuousScanDetector;
  if (!detector) return "";
  return await detectBarcodeFromPreview(elements.scannerPreview, detector, 8) ||
    await detectBarcodeFromCanvas(elements.scannerPreview, detector, 4);
}

function rememberContinuousCode(code) {
  if (!code) return;
  if (code === state.continuousCandidateCode) {
    state.continuousCandidateHits += 1;
  } else {
    state.continuousCandidateCode = code;
    state.continuousCandidateHits = 1;
  }
  if (state.continuousCandidateHits >= 2) {
    state.continuousStableCode = code;
    state.continuousStableAt = Date.now();
  }
}

async function watchContinuousBarcodeCandidate() {
  if (state.continuousBarcodeDetectorRunning) return;
  state.continuousBarcodeDetectorRunning = true;
  try {
    while (state.continuousScanning && state.continuousScanDetector) {
      let code = "";
      try {
        const codes = await state.continuousScanDetector.detect(elements.scannerPreview);
        code = codes.length ? pickBestBarcode(codes) : "";
      } catch (error) {
        code = "";
      }
      rememberContinuousCode(code);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  } catch (error) {
    console.error("Continuous barcode watch failed", error);
  } finally {
    state.continuousBarcodeDetectorRunning = false;
  }
}

function watchContinuousBarcodeCandidateWithZxing() {
  if (!state.continuousZxingReader?.decodeFromVideoElementContinuously) {
    showScanMessage(elements.scanMessage, "このSafariでは連続読取を開始できません。ブラウザを更新してもう一度試してください。");
    return;
  }
  state.continuousZxingRunning = true;
  try {
    state.continuousZxingReader.decodeFromVideoElementContinuously(elements.scannerPreview, (result) => {
      if (!state.continuousScanning || !result) return;
      rememberContinuousCode(normalizeScannedCode(result.getText()));
    });
  } catch (error) {
    state.continuousZxingRunning = false;
  }
}

async function waitForContinuousStableCode(timeoutMs = 700) {
  const startedAt = Date.now();
  while (state.continuousScanning && !state.continuousStableCode && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return state.continuousStableCode;
}

function createZxingReader() {
  if (!window.ZXing?.BrowserMultiFormatReader) return null;
  const hints = new Map();
  if (window.ZXing.DecodeHintType && window.ZXing.BarcodeFormat) {
    hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      window.ZXing.BarcodeFormat.EAN_13,
      window.ZXing.BarcodeFormat.EAN_8,
      window.ZXing.BarcodeFormat.UPC_A,
      window.ZXing.BarcodeFormat.UPC_E,
      window.ZXing.BarcodeFormat.CODE_128
    ]);
    hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true);
  }
  return new ZXing.BrowserMultiFormatReader(hints, 40);
}

async function waitForZxing(timeoutMs = 2500) {
  const startedAt = Date.now();
  while (!window.ZXing?.BrowserMultiFormatReader && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return Boolean(window.ZXing?.BrowserMultiFormatReader);
}

async function scanWithZxing(previewEl, timeoutMs = 10000) {
  if (!(await waitForZxing())) return "";
  const reader = createZxingReader();
  if (!reader) return "";
  const decode = reader.decodeOnceFromVideoElement || reader.decodeFromVideoElement;
  if (!decode) return "";
  try {
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
    const result = await Promise.race([
      decode.call(reader, previewEl),
      timeout
    ]);
    return result ? normalizeScannedCode(result.getText()) : "";
  } catch (error) {
    return "";
  } finally {
    reader.reset();
  }
}

async function scanBarcodeToInput(targetInput, messageEl, previewEl, onCode) {
  let stream;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showScanMessage(messageEl, "このブラウザではカメラを開始できません。HTTPSのサイトURLで開いているか確認してください。");
      return;
    }

    previewEl.hidden = false;
    showScanMessage(messageEl, "JANコードをカメラに向けてください。");

    stream = await prepareScannerStream(previewEl);
    let code = await scanWithZxing(previewEl, 9000);
    if (!code) code = await scanWithBarcodeDetector(previewEl, 3500);

    if (code) {
      targetInput.value = code;
      targetInput.dispatchEvent(new Event("input", { bubbles: true }));
      if (onCode) {
        const saved = await onCode(code);
        showScanMessage(messageEl, saved ? `読み取りました: ${code} / 加算しました` : `読み取りました: ${code} / 棚番を入力してください`);
      } else {
        showScanMessage(messageEl, `読み取りました: ${code}`);
      }
    } else {
      showScanMessage(messageEl, "読み取れませんでした。明るい場所でJANコードを大きく映してください。");
    }
  } catch (error) {
    showScanMessage(messageEl, "カメラを開始できませんでした。ブラウザのカメラ権限を確認してください。");
  } finally {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    previewEl.hidden = true;
  }
}

async function startContinuousCountScan() {
  if (state.editingCountId) {
    showScanMessage(elements.scanMessage, "編集中は連続読取を開始できません。更新または削除を完了してください。");
    return;
  }
  const shelfNo = normalizeShelf(window.prompt("連続読取で使う棚番を入力してください。", elements.shelfNo.value || "") || "");
  if (!shelfNo) {
    elements.shelfNo.focus();
    showScanMessage(elements.scanMessage, "連続読取を開始するには棚番を入力してください。");
    return;
  }
  elements.shelfNo.value = shelfNo;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showScanMessage(elements.scanMessage, "このブラウザではカメラを開始できません。HTTPSのサイトURLで開いているか確認してください。");
    return;
  }
  const canUseBarcodeDetector = "BarcodeDetector" in window;
  const canUseZxing = await waitForZxing();
  if (!canUseBarcodeDetector && !canUseZxing) {
    showScanMessage(elements.scanMessage, "連続読取を開始できません。Safariではページを再読み込みしてからもう一度試してください。");
    return;
  }

  state.continuousScanning = true;
  state.continuousReadQueue = 0;
  state.continuousReadProcessing = false;
  state.continuousReadCount = 0;
  state.continuousCandidateCode = "";
  state.continuousCandidateHits = 0;
  state.continuousStableCode = "";
  state.continuousStableAt = 0;
  state.continuousBarcodeDetectorRunning = false;
  state.continuousZxingRunning = false;
  elements.continuousScanButton.textContent = "連続読取停止";
  elements.continuousScanButton.classList.add("danger");
  elements.scanButton.disabled = true;
  document.body.classList.add("continuous-scan-active");
  elements.continuousScannerStage.hidden = false;
  elements.scannerPreview.hidden = false;
  elements.continuousScanControls.hidden = false;
  showScanMessage(elements.scanMessage, "連続読取中です。JANを映して大きな「読取」を押してください。");

  try {
    state.continuousScanStream = await prepareScannerStream(elements.scannerPreview);
    if (canUseBarcodeDetector) {
      state.continuousScanDetector = new BarcodeDetector({ formats: BARCODE_FORMATS });
      watchContinuousBarcodeCandidate();
    }
    if (canUseZxing) {
      state.continuousZxingReader = createZxingReader();
      watchContinuousBarcodeCandidateWithZxing();
    }
  } catch (error) {
    showScanMessage(elements.scanMessage, "カメラを開始できませんでした。ブラウザのカメラ権限を確認してください。");
    stopContinuousCountScan({ silent: true });
  }
}

async function readContinuousCountScan() {
  if (!state.continuousScanning) return;
  state.continuousReadQueue += 1;
  if (state.continuousReadProcessing) return;

  state.continuousReadProcessing = true;
  while (state.continuousReadQueue > 0 && state.continuousScanning) {
    state.continuousReadQueue -= 1;
    const shelfNo = normalizeShelf(elements.shelfNo.value);
    if (!shelfNo) {
      showScanMessage(elements.scanMessage, "棚番を入力してください。");
      break;
    }
    try {
      let code = state.continuousStableCode || await waitForContinuousStableCode();
      if (!code && state.continuousScanDetector) {
        code = await detectContinuousCodeWithBarcodeDetector();
      }
      if (code) {
        rememberContinuousCode(code);
      }
      if (!code) {
        elements.scannerPreview.hidden = false;
        if (state.continuousScanStream && elements.scannerPreview.srcObject !== state.continuousScanStream) {
          elements.scannerPreview.srcObject = state.continuousScanStream;
          elements.scannerPreview.play().catch(() => null);
        }
        showScanMessage(elements.scanMessage, "読み取れませんでした。カメラは起動中です。JANを大きく映してもう一度押してください。");
        continue;
      }
      elements.countSearch.value = code;
      elements.shelfNo.value = shelfNo;
      elements.countQty.value = "1";
      elements.countSearch.dispatchEvent(new Event("input", { bubbles: true }));
      const saved = await saveCountFromInputs();
      if (saved) {
        state.continuousReadCount += 1;
        showScanMessage(elements.scanMessage, `読取 ${state.continuousReadCount}件目: ${code}`);
      }
    } catch (error) {
      showScanMessage(elements.scanMessage, "読み取りに失敗しました。もう一度押してください。");
    }
  }
  state.continuousReadProcessing = false;
}

function stopContinuousCountScan({ silent = false } = {}) {
  const readCount = state.continuousReadCount;
  state.continuousScanning = false;
  state.continuousReadQueue = 0;
  state.continuousReadProcessing = false;
  state.continuousScanDetector = null;
  if (state.continuousZxingReader) {
    state.continuousZxingReader.reset();
    state.continuousZxingReader = null;
  }
  state.continuousCandidateCode = "";
  state.continuousCandidateHits = 0;
  state.continuousStableCode = "";
  state.continuousStableAt = 0;
  state.continuousBarcodeDetectorRunning = false;
  state.continuousZxingRunning = false;
  if (state.continuousScanStream) {
    state.continuousScanStream.getTracks().forEach((track) => track.stop());
    state.continuousScanStream = null;
  }
  elements.continuousScanButton.textContent = "連続読取";
  elements.continuousScanButton.classList.remove("danger");
  elements.scanButton.disabled = false;
  document.body.classList.remove("continuous-scan-active");
  elements.continuousScanControls.hidden = true;
  elements.scannerPreview.hidden = true;
  elements.continuousScannerStage.hidden = true;
  if (!silent) showScanMessage(elements.scanMessage, readCount ? `連続読取を停止しました: ${readCount}件` : "連続読取を停止しました。");
}

async function enterRoom(roomId, userName, { create = false } = {}) {
  pruneExpiredLocalRooms();
  state.roomId = normalizeRoom(roomId);
  state.userName = String(userName || "").trim();
  state.deviceId = getDeviceId();
  state.roomCreatedAt = "";
  state.setupLocked = true;
  localStorage.setItem(userKey, state.userName);
  elements.activeRoomCode.textContent = `部屋 ${state.roomId}`;
  elements.activeUserName.textContent = `担当 ${state.userName}`;
  loadLocal(state.roomId);

  if (cloudReady()) {
    setSyncStatus("接続中", "muted");
    await deleteExpiredCloudRooms().catch(() => null);
    await ensureCloudRoom().catch((error) => setSyncStatus(`同期失敗: ${error.message}`, "danger"));
    const incoming = await fetchCloudState(state.roomId).catch(() => null);
    if (incoming) applyPayload(incoming);
    saveLocal();
  }

  elements.lockScreen.hidden = true;
  elements.appShell.hidden = false;
  render();
  startPolling();
  history.replaceState(null, "", `${location.pathname}?room=${encodeURIComponent(state.roomId)}`);
}

elements.cloudSetupNotice.hidden = Boolean(cloudReady());
pruneExpiredLocalRooms();

const urlRoom = normalizeRoom(new URLSearchParams(location.search).get("room"));
elements.userName.value = localStorage.getItem(userKey) || "";
if (urlRoom) {
  elements.roomCode.value = urlRoom;
}

elements.createRoom.addEventListener("click", () => {
  const userName = elements.userName.value.trim();
  if (!userName) {
    elements.userName.focus();
    return;
  }
  enterRoom(generateRoomCode(), userName, { create: true });
});

elements.joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const roomId = normalizeRoom(elements.roomCode.value);
  const userName = elements.userName.value.trim();
  if (!userName) {
    elements.userName.focus();
    return;
  }
  if (!roomId) return;
  enterRoom(roomId, userName);
});

elements.logout.addEventListener("click", () => {
  saveLocal();
  clearInterval(state.pollTimer);
  state.roomId = "";
  state.roomCreatedAt = "";
  elements.lockScreen.hidden = false;
  elements.appShell.hidden = true;
  history.replaceState(null, "", location.pathname);
});

elements.copyInvite.addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(state.roomId)}`;
  await navigator.clipboard.writeText(url);
  setSyncStatus("リンクコピー済み", "ok");
});

elements.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    elements.tabs.forEach((item) => item.classList.toggle("active", item === tab));
    elements.panels.forEach((panel) => panel.classList.toggle("active", panel.id === tab.dataset.tab));
  });
});

elements.setupLockToggle.addEventListener("click", () => {
  if (state.setupLocked) {
    const answer = window.prompt("設定ロックを解除するには「解除」と入力してください。");
    if (answer !== "解除") {
      setSyncStatus("設定ロック中", "danger");
      return;
    }
    setSetupLocked(false);
    renderProducts();
    setSyncStatus("設定ロック解除中", "ok");
    return;
  }
  setSetupLocked(true);
  renderProducts();
  setSyncStatus("設定をロックしました", "ok");
});

elements.productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.setupLocked) {
    setSyncStatus("設定ロック中", "danger");
    return;
  }
  const product = {
    jan: normalizeJan(elements.productJan.value),
    name: elements.productName.value.trim(),
    expected: toInt(elements.expectedQty.value)
  };
  if (!product.jan || !product.name) return;
  await pullCloudRoom({ renderAfter: false });
  upsertProduct(product);
  await tryCloud(() => saveCloudProduct(product));
  elements.productForm.reset();
  elements.expectedQty.value = "0";
  render();
});

elements.productRows.addEventListener("click", async (event) => {
  if (state.setupLocked) {
    setSyncStatus("設定ロック中", "danger");
    return;
  }
  const editJan = event.target.dataset.edit;
  const deleteJan = event.target.dataset.deleteProduct;
  if (editJan) {
    const product = state.products.find((item) => item.jan === editJan);
    if (!product) return;
    elements.productJan.value = product.jan;
    elements.productName.value = product.name;
    elements.expectedQty.value = product.expected;
  }
  if (deleteJan) {
    await pullCloudRoom({ renderAfter: false });
    await tryCloud(() => deleteCloudProduct(deleteJan));
    state.products = state.products.filter((item) => item.jan !== deleteJan);
    state.countEntries = state.countEntries.filter((entry) => entry.jan !== deleteJan);
    render();
  }
});

elements.csvImport.addEventListener("change", async (event) => {
  if (state.setupLocked) {
    event.target.value = "";
    setSyncStatus("設定ロック中", "danger");
    return;
  }
  const file = event.target.files[0];
  if (!file) return;
  await pullCloudRoom({ renderAfter: false });
  const products = parseCsv(await file.text());
  if (!products.length) {
    event.target.value = "";
    setSyncStatus("取り込める商品がありません", "danger");
    return;
  }
  products.forEach(upsertProduct);
  await tryCloud(() => saveCloudProducts(products));
  event.target.value = "";
  render();
  setSyncStatus(`CSV取込 ${products.length}件`, "ok");
});

elements.countSearch.addEventListener("input", () => {
  const product = findProduct(elements.countSearch.value);
  elements.selectedProduct.hidden = !product;
  elements.selectedProduct.textContent = product ? `${product.name} / 予定 ${product.expected}` : "";
});

elements.reviewSearch.addEventListener("input", () => {
  state.reviewSearch = elements.reviewSearch.value;
  renderReview();
});

elements.diffOnly.addEventListener("change", () => {
  state.diffOnly = elements.diffOnly.checked;
  renderReview();
});

elements.shelfNo.addEventListener("input", () => {
  elements.shelfNo.value = elements.shelfNo.value.replace(/\s+/g, "").slice(0, 20);
});

elements.shelfNo.addEventListener("blur", () => {
  if (elements.shelfNo.value) elements.shelfNo.value = normalizeShelf(elements.shelfNo.value);
});

async function saveCountFromInputs() {
  await pullCloudRoom({ renderAfter: false });
  const product = findProduct(elements.countSearch.value);
  const searchValue = normalizeJan(elements.countSearch.value);
  const jan = product ? product.jan : isNumericCode(searchValue) ? searchValue : fallbackJanFromName(searchValue);
  const shelfNo = normalizeShelf(elements.shelfNo.value);
  const qty = Math.max(1, toInt(elements.countQty.value));
  if (!jan || !shelfNo) return false;
  if (!product) {
    const provisionalProduct = {
      jan,
      name: searchValue,
      expected: 0
    };
    upsertProduct(provisionalProduct);
    const savedProduct = state.products.find((item) => item.jan === jan) || provisionalProduct;
    await tryCloud(() => saveCloudProduct(savedProduct));
  }
  if (state.editingCountId) {
    const entry = state.countEntries.find((item) => item.id === state.editingCountId && item.deviceId === state.deviceId);
    if (entry) {
      entry.jan = jan;
      entry.shelfNo = shelfNo;
      entry.qty = qty;
      entry.userName = state.userName;
      entry.updatedAt = new Date().toISOString();
      await tryCloud(() => saveCloudEntry(entry));
    }
  } else {
    const entry = state.countEntries.find((item) => (
      item.deviceId === state.deviceId &&
      item.jan === jan &&
      normalizeShelf(item.shelfNo) === shelfNo &&
      toInt(item.qty) > 0
    ));
    if (entry) {
      entry.qty = toInt(entry.qty) + qty;
      entry.userName = state.userName;
      entry.updatedAt = new Date().toISOString();
    } else {
      state.countEntries.push({
        id: makeEntryId(),
        deviceId: state.deviceId,
        userName: state.userName,
        jan,
        shelfNo,
        qty,
        createdAt: new Date().toISOString()
      });
    }
    const savedEntry = entry || state.countEntries[state.countEntries.length - 1];
    await tryCloud(() => saveCloudEntry(savedEntry));
  }
  state.editingCountId = "";
  elements.countSubmit.textContent = "加算";
  elements.countSearch.value = "";
  elements.shelfNo.value = shelfNo;
  elements.countQty.value = "1";
  elements.selectedProduct.hidden = true;
  render();
  return true;
}

elements.countForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveCountFromInputs();
});

elements.takeoverEntryButton.addEventListener("click", async () => {
  await pullCloudRoom({ renderAfter: false });
  const candidates = state.countEntries
    .filter((entry) => entry.deviceId !== state.deviceId && toInt(entry.qty) > 0)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!candidates.length) {
    setSyncStatus("引継ぎできる他担当者の入力はありません", "muted");
    return;
  }

  const lines = candidates.slice(0, 20).map((entry, index) => {
    const product = state.products.find((item) => item.jan === entry.jan) || { name: "未登録商品" };
    return `${index + 1}: ${entry.userName || "担当未設定"} / ${entry.shelfNo || "000"} / ${product.name} / ${toInt(entry.qty)}点`;
  });
  const answer = window.prompt(`引き継ぐ入力の番号を入力してください。\n\n${lines.join("\n")}`);
  const index = toInt(answer) - 1;
  const entry = candidates[index];
  if (!entry) return;
  if (!takeoverEntry(entry)) return;
  await tryCloud(() => saveCloudEntry(entry));
  setSyncStatus("入力を引き継ぎました", "ok");
  render();
});

elements.countRows.addEventListener("click", async (event) => {
  const editId = event.target.dataset.editEntry;
  const minusId = event.target.dataset.minusEntry;
  const deleteId = event.target.dataset.deleteEntry;
  if (editId) {
    const entry = state.countEntries.find((item) => item.id === editId && item.deviceId === state.deviceId);
    if (!entry) return;
    state.editingCountId = editId;
    elements.countSearch.value = entry.jan;
    elements.shelfNo.value = entry.shelfNo || "";
    elements.countQty.value = toInt(entry.qty) || 1;
    elements.countSubmit.textContent = "更新";
    elements.countSearch.dispatchEvent(new Event("input", { bubbles: true }));
    elements.countSearch.focus();
    return;
  }
  await pullCloudRoom({ renderAfter: false });
  if (minusId) {
    const entry = state.countEntries.find((item) => item.id === minusId && item.deviceId === state.deviceId);
    if (entry) {
      entry.qty = Math.max(0, toInt(entry.qty) - 1);
      if (entry.qty > 0) {
        await tryCloud(() => saveCloudEntry(entry));
      } else {
        await tryCloud(() => deleteCloudEntry(entry.id));
      }
    }
  }
  if (deleteId) {
    await tryCloud(() => deleteCloudEntry(deleteId));
    state.countEntries = state.countEntries.filter((entry) => !(entry.id === deleteId && entry.deviceId === state.deviceId));
    if (state.editingCountId === deleteId) {
      state.editingCountId = "";
      elements.countSubmit.textContent = "加算";
      elements.countForm.reset();
      elements.countQty.value = "1";
    }
  }
  state.countEntries = state.countEntries.filter((entry) => toInt(entry.qty) > 0);
  render();
});

elements.exportCsv.addEventListener("click", () => {
  downloadCsv();
});
elements.productScanButton.addEventListener("click", () => {
  if (state.setupLocked) {
    setSyncStatus("設定ロック中", "danger");
    return;
  }
  scanBarcodeToInput(elements.productJan, elements.productScanMessage, elements.productScannerPreview);
});
elements.scanButton.addEventListener("click", () => {
  scanBarcodeToInput(elements.countSearch, elements.scanMessage, elements.countScannerPreview, () => saveCountFromInputs());
});
elements.continuousScanButton.addEventListener("click", () => {
  if (state.continuousScanning) {
    stopContinuousCountScan();
  } else {
    startContinuousCountScan();
  }
});
elements.continuousReadButton.addEventListener("click", () => {
  readContinuousCountScan();
});
elements.continuousStopButton.addEventListener("click", () => {
  stopContinuousCountScan();
});
