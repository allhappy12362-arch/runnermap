// ── 카카오맵 동적 로드 ──
function loadKakaoMap() {
  if (!KAKAO_APP_KEY || KAKAO_APP_KEY === 'YOUR_KAKAO_APP_KEY') {
    showMapPlaceholder();
    return;
  }
  const script = document.createElement('script');
  script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_APP_KEY}&libraries=services&autoload=false`;
  script.onload = () => {
    kakao.maps.load(() => {
      initKakaoMap();
    });
  };
  document.head.appendChild(script);
}

function showMapPlaceholder() {
  document.getElementById('kakaoMap').innerHTML = `
    <div class="map-placeholder">
      <div class="map-placeholder-icon">🗺️</div>
      <div class="map-placeholder-text">
        카카오맵 API 키를 넣으면 실제 지도가 표시돼요<br>
        <a href="https://developers.kakao.com" target="_blank">developers.kakao.com</a>에서 발급 후<br>
        index.html 상단 <code>KAKAO_APP_KEY</code>에 입력해주세요
      </div>
    </div>`;
}

let kakaoMap = null;
let myMarker = null;
let courseMarkers = [];
let activePolyline = null;
let activeRouteMarkers = [];

function initKakaoMap() {
  const container = document.getElementById('kakaoMap');
  const options = {
    center: new kakao.maps.LatLng(37.5326, 127.0246),
    level: 7,
    mapTypeId: kakao.maps.MapTypeId.ROADMAP
  };
  kakaoMap = new kakao.maps.Map(container, options);
  kakaoMap.setZoomable(true);

  // 내 위치
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const myPos = new kakao.maps.LatLng(lat, lng);
      kakaoMap.setCenter(myPos);
    }, () => {});
  }

  renderMapMarkers();
}

function renderMapMarkers() {
  if (!kakaoMap || !COURSES || !COURSES.length) return;
  courseMarkers.forEach(m => m.setMap(null));
  courseMarkers = [];

  const filtered = getFilteredCourses();

  filtered.forEach(c => {
    const isSelected = currentCourseId === c.id;
    const color = '#ff2020';
    const size = isSelected ? 32 : 24;
    const glow = isSelected ? `<circle cx="0" cy="0" r="${size+6}" fill="rgba(255,32,32,0.22)"/>` : '';

    // 달리는 사람 SVG (핀 형태, 빨간색)
    const svgPin = `<svg xmlns="http://www.w3.org/2000/svg" 
      width="${size*2+12}" height="${size*2+16}" 
      viewBox="${-size-6} ${-size-6} ${size*2+12} ${size*2+16}"
      style="overflow:visible;display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">
      ${glow}
      <!-- 핀 몸통 -->
      <circle cx="0" cy="0" r="${size}" fill="${color}" opacity="0.92"/>
      <circle cx="0" cy="0" r="${size}" fill="none" stroke="white" stroke-width="${isSelected?2:1.5}" opacity="0.6"/>
      <!-- 핀 꼬리 -->
      <polygon points="0,${size} ${-size*0.35},${size*1.5} ${size*0.35},${size*1.5}" fill="${color}" opacity="0.92"/>
      <!-- 달리는 사람 (흰색) -->
      <!-- 머리 -->
      <circle cx="${size*0.15}" cy="${-size*0.52}" r="${size*0.18}" fill="white"/>
      <!-- 몸통 -->
      <line x1="${size*0.05}" y1="${-size*0.34}" x2="${-size*0.1}" y2="${size*0.12}" 
        stroke="white" stroke-width="${size*0.12}" stroke-linecap="round"/>
      <!-- 팔 (앞) -->
      <line x1="${size*0.05}" y1="${-size*0.18}" x2="${size*0.38}" y2="${-size*0.38}" 
        stroke="white" stroke-width="${size*0.1}" stroke-linecap="round"/>
      <!-- 팔 (뒤) -->
      <line x1="${size*0.0}" y1="${-size*0.2}" x2="${-size*0.32}" y2="${-size*0.05}" 
        stroke="white" stroke-width="${size*0.1}" stroke-linecap="round"/>
      <!-- 다리 (앞) -->
      <line x1="${-size*0.1}" y1="${size*0.12}" x2="${size*0.28}" y2="${size*0.42}" 
        stroke="white" stroke-width="${size*0.11}" stroke-linecap="round"/>
      <!-- 다리 (뒤) -->
      <line x1="${-size*0.1}" y1="${size*0.12}" x2="${-size*0.35}" y2="${size*0.38}" 
        stroke="white" stroke-width="${size*0.11}" stroke-linecap="round"/>
    </svg>`;

    const content = `<div style="cursor:pointer;display:flex;justify-content:center" onclick="handlePinClick(${c.id})">${svgPin}</div>`;
    const overlay = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(c.lat, c.lng),
      content,
      yAnchor: 1.3
    });
    overlay.setMap(kakaoMap);
    courseMarkers.push(overlay);
  });
}

function handlePinClick(id) {
  // 핀 클릭: 경로 그리고 상세도 오픈
  showCourseRoute(id);
  openDetail(id);
}

function showCourseRoute(id) {
  if (!kakaoMap) return;
  const c = COURSES.find(x => x.id === id);
  if (!c || !c.path || !c.path.length) return;

  // 기존 경로 제거
  clearRouteOverlay();

  const colorMap = { scenic: '#4d9fff', quiet: '#9d7fff', night: '#ff9d3d', workout: '#ff4d4d' };
  const color = colorMap[c.type] || '#c8ff00';

  // Polyline 경로 그리기
  const linePath = c.path.map(([lat, lng]) => new kakao.maps.LatLng(lat, lng));
  activePolyline = new kakao.maps.Polyline({
    map: kakaoMap,
    path: linePath,
    strokeWeight: 5,
    strokeColor: color,
    strokeOpacity: 0.85,
    strokeStyle: 'solid'
  });

  // 시작점 마커 🟢
  const startContent = `<div style="display:flex;flex-direction:column;align-items:center">
    <div style="background:#0d0d0d;border:1.5px solid #c8ff00;border-radius:20px;padding:2px 8px;font-size:10px;color:#c8ff00;font-family:'Noto Sans KR',sans-serif;margin-bottom:3px;white-space:nowrap;">▶ 출발</div>
    <div style="width:10px;height:10px;border-radius:50%;background:#c8ff00;border:2px solid #0d0d0d;"></div>
  </div>`;
  const startOverlay = new kakao.maps.CustomOverlay({
    position: linePath[0], content: startContent, yAnchor: 1
  });
  startOverlay.setMap(kakaoMap);
  activeRouteMarkers.push(startOverlay);

  // 도착점 마커 🔴
  const endPt = linePath[linePath.length - 1];
  const endContent = `<div style="display:flex;flex-direction:column;align-items:center">
    <div style="background:#0d0d0d;border:1.5px solid ${color};border-radius:20px;padding:2px 8px;font-size:10px;color:${color};font-family:'Noto Sans KR',sans-serif;margin-bottom:3px;white-space:nowrap;">■ 도착</div>
    <div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #0d0d0d;"></div>
  </div>`;
  const endOverlay = new kakao.maps.CustomOverlay({
    position: endPt, content: endContent, yAnchor: 1
  });
  endOverlay.setMap(kakaoMap);
  activeRouteMarkers.push(endOverlay);

  // 지도 zoom & 중앙 이동 — 경로 전체가 보이게
  const bounds = new kakao.maps.LatLngBounds();
  linePath.forEach(p => bounds.extend(p));
  kakaoMap.setBounds(bounds, 60); // 패딩 60px

  // 지도 상단 route info 표시
  document.getElementById('routeInfoKm').textContent = c.km + 'km';
  document.getElementById('routeInfoName').textContent = c.name;
  document.getElementById('routeInfoOverlay').classList.add('visible');
}

function clearRouteOverlay() {
  if (activePolyline) { activePolyline.setMap(null); activePolyline = null; }
  activeRouteMarkers.forEach(m => m.setMap(null));
  activeRouteMarkers = [];
  document.getElementById('routeInfoOverlay').classList.remove('visible');
}

function moveToMyLocation() {
  if (!kakaoMap) return;
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      kakaoMap.setCenter(new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude));
    });
  }
}
// ── 데이터 로드 ──
let COURSES = [];
let savedCourses = JSON.parse(localStorage.getItem('rm_saved') || '[]');
let recentCourses = JSON.parse(localStorage.getItem('rm_recent') || '[]');
let records = JSON.parse(localStorage.getItem('rm_records') || '[]');
let activeFilter = 'all';
let currentCourseId = null;
let recordStar = 0, recordDiff = '', recordWant = '';
let firstSave = localStorage.getItem('rm_firstsave') !== '1';

// ── Supabase에서 코스 데이터 로드 ──
// ── Supabase REST API 직접 호출 ──
const SUPABASE_URL = 'https://zalmzgvikgayhhzuvxsx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphbG16Z3Zpa2dheWhoenV2eHN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0MzkxNTYsImV4cCI6MjA5MzAxNTE1Nn0.v4Ogyf7vE5C3NFQKnYamR0dQdKcWRMz2k_iyN89vefY';

const sb = {
  _headers: {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  },
  async select(table, params = '') {
    if (SUPABASE_KEY === 'YOUR_SUPABASE_ANON_KEY') throw new Error('Supabase anon 키를 설정해주세요');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      headers: this._headers
    });
    if (!res.ok) throw new Error(`DB 오류: ${res.status}`);
    return res.json();
  },
  async insert(table, data) {
    if (SUPABASE_KEY === 'YOUR_SUPABASE_ANON_KEY') throw new Error('Supabase anon 키를 설정해주세요');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: this._headers,
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }
    return true;
  }
};

async function loadCourses() {
  try {
    const data = await sb.select('courses', 'status=eq.active&order=id');
    if (!data || !data.length) throw new Error('코스 데이터가 없어요');

    // DB 컬럼명 → 기존 코드 호환 변환
    COURSES = data.map(c => ({
      id: c.id,
      name: c.name,
      region: c.region,
      lat: parseFloat(c.lat),
      lng: parseFloat(c.lng),
      km: parseFloat(c.km),
      distFrom: c.dist_from,
      type: c.type,
      feel: c.feel,
      desc: c.description,
      pop: c.pop,
      busyTime: c.busy_time,
      busy: c.busy,
      free: c.free,
      review: c.review,
      shortCourse: c.short_course,
      tags: typeof c.tags === 'string' ? JSON.parse(c.tags) : c.tags,
      vibes: typeof c.vibes === 'string' ? JSON.parse(c.vibes) : c.vibes,
      facilities: typeof c.facilities === 'string' ? JSON.parse(c.facilities) : c.facilities,
      fit: typeof c.fit === 'string' ? JSON.parse(c.fit) : c.fit,
      downsides: typeof c.downsides === 'string' ? JSON.parse(c.downsides) : c.downsides,
      groupSize: typeof c.group_size === 'string' ? JSON.parse(c.group_size) : c.group_size,
      path: typeof c.path === 'string' ? JSON.parse(c.path) : c.path,
      startPoint: typeof c.start_point === 'string' ? JSON.parse(c.start_point) : c.start_point,
      mapLevel: c.map_level
    }));

    const _cc=document.getElementById('courseCount'); if(_cc) _cc.textContent = COURSES.length; const cc2=document.getElementById('courseCount2'); if(cc2) cc2.textContent=COURSES.length;
    renderList();
    loadKakaoMap();
    setTimeout(() => renderMapMarkers(), 1500);
    checkUrlCourse();
  } catch(e) {
    console.error('Supabase 실패, courses.json으로 대체:', e.message);
    console.warn('💡 Supabase 연결 실패 원인: Supabase Dashboard → Project Settings → API → "anon public" 키(eyJ...로 시작하는 JWT)를 SUPABASE_KEY에 입력하세요.');
    try {
      const res = await fetch('courses.json');
      const data = await res.json();
      COURSES = data;
      const _cc=document.getElementById('courseCount'); if(_cc) _cc.textContent = COURSES.length; const cc2=document.getElementById('courseCount2'); if(cc2) cc2.textContent=COURSES.length;
      renderList();
      loadKakaoMap();
      setTimeout(() => renderMapMarkers(), 1500);
      checkUrlCourse();
    } catch(e2) {
      const _cle=document.getElementById('courseList'); if(_cle) _cle.innerHTML =
        '<div style="padding:20px;font-size:13px;color:var(--text3)">코스 데이터를 불러오지 못했어요. 잠시 후 다시 시도해주세요.</div>';
    }
  }
}

async function uploadCourseImage(event) {
  const file = event.target.files[0];
  if (!file || !currentCourseId) return;

  const ext = file.name.split('.').pop();
  const path = `course-${currentCourseId}-${Date.now()}.${ext}`;

  showToast('이미지 업로드 중...');

  try {
    // Storage 업로드
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/course-images/${path}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': file.type,
        'x-upsert': 'true'
      },
      body: file
    });
    if (!res.ok) throw new Error('업로드 실패');

    const imageUrl = `${SUPABASE_URL}/storage/v1/object/public/course-images/${path}`;

    // DB 업데이트
    const upRes = await fetch(`${SUPABASE_URL}/rest/v1/courses?id=eq.${currentCourseId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ image_url: imageUrl })
    });
    if (!upRes.ok) throw new Error('DB 업데이트 실패');

    // 로컬 데이터 반영
    const c = COURSES.find(x => x.id === currentCourseId);
    if (c) c.image_url = imageUrl;

    // 헤더 이미지 즉시 반영
    const headerImg = document.getElementById('detailHeaderImg');
    headerImg.style.backgroundImage = `url(${imageUrl})`;
    headerImg.style.backgroundSize = 'cover';
    headerImg.style.backgroundPosition = 'center';

    showToast('이미지 업로드 완료! 🎉');
  } catch(e) {
    showToast('업로드 실패: ' + e.message);
  }

  event.target.value = '';
}

// 동기부여 명언
const MOTIVATION_QUOTES = [
  ["뛰는 것은 단순히 몸을 움직이는 게 아니라, 자신을 발견하는 여정이다.", "하이데 로제"],
  ["불가능이란 아무것도 하지 않는 사람이 만들어낸 핑계다.", "무하마드 알리"],
  ["매일 조금씩, 하지만 절대 멈추지 않는다.", "마우리시오 왈쉬"],
  ["고통은 일시적이다. 포기는 영원하다.", "랜스 암스트롱"],
  ["당신이 달릴 수 있을 때 달려라. 달릴 수 없을 때도 뛰어라. 절대 멈추지 마라.", "딘 카르나지스"],
  ["매 걸음마다 당신은 더 강해진다.", "에밀 자토펙"],
  ["오늘 힘들었던 만큼 내일은 더 빨라진다.", "스티브 프리폰테인"],
  ["한계는 마음속에만 있다. 몸은 마음이 믿는 것까지만 간다.", "로저 배니스터"],
  ["챔피언은 훈련하고, 고통을 참고, 원하는 동안 만들어진다.", "무하마드 알리"],
  ["달리기는 자유다. 내 두 발이 닿는 곳 어디든 내 세상이 된다.", "윌마 루돌프"],
  ["출발선에 서는 것이 이미 절반의 승리다.", "마이클 조던"],
  ["가장 빠른 길은 꾸준히 가는 것이다.", "찰스 다윈"],
  ["당신의 잠재력은 당신이 포기하는 순간 결정된다.", "마이클 조던"],
  ["시작하는 것이 성공의 절반이다.", "플라톤"],
  ["오늘의 땀이 내일의 나를 만든다.", "칼 루이스"],
  ["두려움을 느끼면서도 달리는 것, 그것이 진정한 용기다.", "빌 로저스"],
  ["끝은 또 다른 시작이다.", "T.S. 엘리엇"],
  ["꿈은 달리는 발 아래서 현실이 된다.", "캐서린 스위처"],
  ["포기하고 싶을 때가 바로 성장하는 순간이다.", "에밀리 케스텐바움"],
  ["내가 멈추지 않는 한, 속도는 중요하지 않다.", "공자"],
];
function getMotivationQuote(courseId) {
  return MOTIVATION_QUOTES[courseId % MOTIVATION_QUOTES.length];
}

// 패널 토글
function togglePanel() {
  const panel = document.getElementById('rightPanel');
  panel.classList.toggle('open');
}

const QUOTES = [
  { text: "고통은 일시적이다. 포기는 영원하다.", author: "Lance Armstrong" },
  { text: "당신이 달리지 않으면, 당신은 이길 수 없다.", author: "Jesse Owens" },
  { text: "몸이 할 수 없다고 말할 때, 마음에게 물어라.", author: "Unknown" },
  { text: "출발선에 서는 것만으로도 절반은 이긴 것이다.", author: "Unknown" },
  { text: "매일 조금씩 더. 그것이 전부다.", author: "Emil Zátopek" },
  { text: "달리는 것은 인생을 이야기하는 가장 직접적인 방법이다.", author: "Bernd Heinrich" },
  { text: "느리게 달려도 괜찮다. 소파에 앉은 사람보다는 빠르다.", author: "Unknown" },
  { text: "한계는 네가 만든 것이다.", author: "Michael Jordan" },
  { text: "불가능은 사실이 아니라 의견이다.", author: "Muhammad Ali" },
  { text: "러닝은 자유다. 아무도 그걸 빼앗을 수 없다.", author: "Grete Waitz" },
  { text: "땀은 결코 거짓말하지 않는다.", author: "Unknown" },
  { text: "오늘의 고통이 내일의 강함이 된다.", author: "Arnold Schwarzenegger" },
  { text: "포기하고 싶을 때가 바로 돌파구가 열리는 순간이다.", author: "Unknown" },
  { text: "기록은 깨지기 위해 존재한다.", author: "Jesse Owens" },
  { text: "두려움을 달리기로 날려버려라.", author: "Kathrine Switzer" },
  { text: "마라톤은 절반이 체력, 절반이 정신력이다.", author: "Unknown" },
  { text: "당신의 다리가 포기해도 당신의 마음은 계속 달린다.", author: "Unknown" },
  { text: "러닝화 끈을 묶는 그 순간, 당신은 이미 달리고 있다.", author: "Unknown" },
  { text: "멀리 보지 마라. 다음 한 걸음만 생각하라.", author: "Unknown" },
  { text: "달리기를 시작하기에 너무 늦은 때란 없다.", author: "John Bingham" },
];

function getMotivationalQuote(courseId) {
  const q = QUOTES[courseId % QUOTES.length];
  return `<div class="quote-text">"${q.text}"</div><div class="quote-author">— ${q.author}</div>`;
}

// ── 전광판 티커 ──
const TICKER_MSGS = [
  "🏃 오늘 달리지 않으면 내일도 핑계가 생긴다",
  "💨 느려도 괜찮다 — 멈추지만 않으면 된다",
  "🔥 땀은 지방이 우는 소리다",
  "⚡ 지금 이 순간도 누군가는 달리고 있다",
  "🎯 목표를 향해 한 걸음씩 — 러너맵이 함께한다",
  "🌅 이른 아침 달리기는 하루를 두 배로 만든다",
  "💪 어제보다 1분 더 — 그게 성장이다",
  "🏅 완주의 기쁨은 출발한 사람만 안다",
  "🌙 야간 러닝은 도시를 나만의 것으로 만드는 시간",
  "🗺️ 새로운 코스, 새로운 나 — 오늘 어디서 달릴까?",
];

function initTicker() {
  const track = document.getElementById('tickerTrack');
  if (!track) return;
  // 두 번 반복해서 seamless loop
  const msgs = [...TICKER_MSGS, ...TICKER_MSGS];
  track.innerHTML = msgs.map(m =>
    `<span class="ticker-item">${m}</span><span class="ticker-dot">●</span>`
  ).join('');
}

function openPopularModal() {
  const overlay = document.getElementById('popularOverlay');
  overlay.classList.add('open');
  const list = document.getElementById('popularList');
  const sorted = [...COURSES].sort((a,b) => (b.pop||0) - (a.pop||0)).slice(0,10);
  list.innerHTML = sorted.map((c,i) => {
    const rankClass = i===0?'gold':i===1?'silver':i===2?'bronze':'';
    return `<div class="popular-item" onclick="closePopularModal();openDetail(${c.id})">
      <div class="popular-rank ${rankClass}">${i+1}</div>
      <div class="popular-info">
        <div class="popular-name">${c.name}</div>
        <div class="popular-meta">${c.region} · ${c.type==='scenic'?'🌅 경치 좋음':c.type==='quiet'?'🌿 조용함':c.type==='workout'?'💪 운동용':'🌙 야간 가능'}</div>
      </div>
      <div class="popular-km">${c.km}km</div>
    </div>`;
  }).join('');
}
function closePopularModal() {
  document.getElementById('popularOverlay').classList.remove('open');
}
function closePopularOnBg(e) {
  if (e.target.id === 'popularOverlay') closePopularModal();
}

loadCourses();
initTicker();

function saveState() {
  localStorage.setItem('rm_saved', JSON.stringify(savedCourses));
  localStorage.setItem('rm_recent', JSON.stringify(recentCourses));
  localStorage.setItem('rm_records', JSON.stringify(records));
}

function addRecent(id) {
  recentCourses = recentCourses.filter(x => x !== id);
  recentCourses.unshift(id);
  if (recentCourses.length > 20) recentCourses.pop();
  saveState();
}

// ── 필터 ──
function getFilteredCourses() {
  const query = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  let result = COURSES.filter(c => {
    const matchFilter = activeFilter === 'all' ? true :
      activeFilter === 'short' ? c.shortCourse : c.vibes[activeFilter] === true;
    const matchSearch = !query ||
      c.name.toLowerCase().includes(query) ||
      c.region.toLowerCase().includes(query) ||
      (c.desc && c.desc.toLowerCase().includes(query));
    return matchFilter && matchSearch;
  });
  if (sortByLocation && myLat && myLng) {
    result = result.slice().sort((a, b) =>
      calcDist(myLat, myLng, a.lat, a.lng) - calcDist(myLat, myLng, b.lat, b.lng)
    );
  }
  return result;
}

function setFilter(el, filter) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  activeFilter = filter;
  renderList();
  renderMapMarkers();
}

// ── 리스트 렌더 ──
function renderList() {
  const filtered = getFilteredCourses();
  const _ccf=document.getElementById('courseCount'); if(_ccf) _ccf.textContent = filtered.length; const cc2b=document.getElementById('courseCount2'); if(cc2b) cc2b.textContent=filtered.length;
  const _cl=document.getElementById('courseList'); if(_cl) _cl.innerHTML = filtered.map(cardHTML).join('');
}

function cardHTML(c) {
  const isSaved = savedCourses.includes(c.id);
  const popDots = Array.from({length:5},(_,i) => `<div class="pop-dot ${i<c.pop?'on':''}"></div>`).join('');
  const tags = c.tags.filter(([,label]) => label).map(([cls,label]) =>
    `<span class="tag ${cls}">${label}</span>`).join('');
  return `
  <div class="course-card ${c.type} ${currentCourseId===c.id?'selected':''}" onclick="openDetail(${c.id})">
    <div class="card-top">
      <div class="card-name">${c.name}</div>
      <div class="card-distance-from">${sortByLocation && myLat ? calcDist(myLat,myLng,c.lat,c.lng).toFixed(1)+'km' : c.distFrom}</div>
    </div>
    <div class="card-meta">
      <div class="card-km">${c.km}km</div>
      <div class="card-feel">${c.feel}</div>
    </div>
    <div class="card-desc">${c.desc}</div>
    <div class="card-group">👥 ${c.groupSize.best}</div>
    <div class="card-bottom">
      <div class="card-stats">
        <div class="card-stat-row">
          <div class="popularity"><div class="pop-bar">${popDots}</div> 인기</div>
          <div class="busy-time">혼잡 <span>${c.busyTime}</span></div>
        </div>
        <div class="card-tags">${tags}</div>
      </div>
      <button class="save-btn ${isSaved?'saved':''}" onclick="event.stopPropagation();toggleSave(${c.id},this)">
        ${isSaved?'♥':'♡'}
      </button>
    </div>
  </div>`;
}

function toggleSave(id, btn) {
  if (savedCourses.includes(id)) {
    savedCourses = savedCourses.filter(x => x !== id);
    btn.classList.remove('saved'); btn.textContent = '♡';
    showToast('저장이 취소됐어요');
  } else {
    savedCourses.push(id);
    btn.classList.add('saved'); btn.textContent = '♥';
    if (firstSave) {
      firstSave = false; localStorage.setItem('rm_firstsave','1');
      showToast('💾 이 기기에 저장됐어요. 브라우저 초기화 시 사라질 수 있어요.');
    } else {
      showToast('💾 이 기기에 저장됐어요');
    }
  }
  saveState(); updateDetailSaveBtn();
}

// ── 상세 ──
function openDetail(id) {
  currentCourseId = id;
  addRecent(id);
  renderList();
  renderMapMarkers();
  const c = COURSES.find(x => x.id === id);
  if (!c) return;

  // 헤더 이미지 적용
  const headerImg = document.getElementById('detailHeaderImg');
  if (c.image_url) {
    headerImg.style.backgroundImage = `url(${c.image_url})`;
    headerImg.style.backgroundSize = 'cover';
    headerImg.style.backgroundPosition = 'center';
  } else {
    headerImg.style.backgroundImage = '';
    headerImg.style.backgroundSize = '';
  }

  const isSaved = savedCourses.includes(id);
  const popStr = '★'.repeat(c.pop) + '☆'.repeat(5-c.pop);

  const vibeItems = [
    [c.vibes.scenic,'🌅 경치 좋음'],
    [c.vibes.quiet, '🌿 조용함'],
    [c.vibes.night, '🌙 야간 안전'],
    [c.vibes.workout,'⛰ 업다운 있음']
  ].map(([v,label]) => `
    <div class="vibe-item ${v?'yes':'no'}">
      <span>${label}</span>
      <span class="vibe-check">${v?'✓':'✗'}</span>
    </div>`).join('');

  const facItems = [
    [c.facilities.toilet, '🚻 화장실', c.facilities.toilet ? '코스 내 공중화장실 있음 — 급할 때 걱정 없어요' : '화장실 없음 — 출발 전 미리 해결하세요'],
    [c.facilities.water,  '💧 음수대', c.facilities.water  ? '음수대 있음 — 물 없이 가도 됩니다'              : '음수대 없음 — 물 챙겨가세요 (500ml 이상)'],
    [c.facilities.store,  '🏪 편의점', c.facilities.store  ? '편의점 근처 있음 — 러닝 후 보충 가능'           : '편의점 없음 — 에너지젤·간식 미리 챙기세요'],
    [c.facilities.spot,   '🧍 집결공간', c.facilities.spot ? '집결 공간 있음 — 크루런·모임 달리기 최적'       : '별도 집결 공간 없음 — 만남 장소 사전 지정 필요'],
  ].map(([v, label, desc]) => `
    <div class="facility-item ${v ? 'yes' : 'no'}">
      <div class="facility-label">${label} ${v ? '있음' : '없음'}</div>
      <div class="facility-desc">${desc}</div>
    </div>`).join('');

  document.getElementById('detailBody').innerHTML = `
    <div class="detail-title">${c.name}</div>
    <div class="detail-region">${c.region}</div>
    <div class="detail-group-badge">
      <span class="detail-group-icon">👥</span>
      <span>${c.groupSize.best}</span>
    </div>
    <div class="detail-stats-row">
      <div class="detail-stat">
        <div class="detail-stat-label">거리</div>
        <div class="detail-stat-value">${c.km}km</div>
        <div class="detail-stat-sub">${c.feel}</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">접근성</div>
        <div class="detail-stat-value">${c.distFrom}</div>
        <div class="detail-stat-sub">현재 위치 기준</div>
      </div>
      <div class="detail-stat">
        <div class="detail-stat-label">인기도</div>
        <div class="detail-stat-value" style="font-size:13px;color:var(--accent)">${popStr}</div>
        <div class="detail-stat-sub">저장 ${c.pop*68+42}명</div>
      </div>
    </div>

    <div class="pace-calc">
      <div class="pace-calc-title">⏱ 내가 뛰면 얼마나 걸릴까?</div>
      <div class="pace-level-row">
        <button class="pace-level-btn active" onclick="setPaceLevel(this,7,0,${c.km})" data-label="🚶 초보">🚶 초보<span>7분/km</span></button>
        <button class="pace-level-btn" onclick="setPaceLevel(this,6,0,${c.km})" data-label="🏃 보통">🏃 보통<span>6분/km</span></button>
        <button class="pace-level-btn" onclick="setPaceLevel(this,5,0,${c.km})" data-label="💨 빠름">💨 빠름<span>5분/km</span></button>
        <button class="pace-level-btn" onclick="setPaceLevel(this,4,0,${c.km})" data-label="🔥 고수">🔥 고수<span>4분/km</span></button>
      </div>
      <div class="pace-custom-row">
        <span class="pace-label">직접 입력</span>
        <input class="pace-input" type="number" id="paceMin" value="7" min="3" max="15" style="max-width:48px" oninput="calcPace(${c.km})">
        <span class="pace-sep">분</span>
        <input class="pace-input" type="number" id="paceSec" value="0" min="0" max="59" style="max-width:48px" oninput="calcPace(${c.km})">
        <span class="pace-sep">초/km</span>
      </div>
      <div class="pace-result-cards">
        <div class="pace-card main">
          <div class="pace-card-icon">⏰</div>
          <div class="pace-card-value" id="paceResultTime">49분 00초</div>
          <div class="pace-card-label">완주 시간</div>
        </div>
        <div class="pace-card">
          <div class="pace-card-icon">🔥</div>
          <div class="pace-card-value" id="paceResultKcal">—</div>
          <div class="pace-card-label">소모 칼로리</div>
        </div>
        <div class="pace-card">
          <div class="pace-card-icon">🍔</div>
          <div class="pace-card-value" id="paceResultFood">—</div>
          <div class="pace-card-label">햄버거 몇 개</div>
        </div>
      </div>
      <div class="pace-tip" id="paceTip"></div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">코스 분위기</div>
      <div class="vibe-grid">${vibeItems}</div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">혼잡도 정보</div>
      <div class="time-blocks">
        <div class="time-block"><span class="time-label">많이 몰리는 시간</span><span class="time-value busy">${c.busy}</span></div>
        <div class="time-block"><span class="time-label">한산한 시간</span><span class="time-value quiet-time">${c.free}</span></div>
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">편의시설</div>
      <div class="facility-grid">${facItems}
        <div class="facility-item yes" style="grid-column:1/-1">
          <div class="facility-label">🚦 신호등 현황</div>
          <div class="facility-desc">${c.facilities.signal === '신호등 없음' ? '신호등 없음 — 끊기지 않고 페이스 유지 가능해요' : c.facilities.signal === '신호등 일부 있음' || c.facilities.signal === '신호등 일부' ? '신호등 일부 있음 — 구간에 따라 멈춤 발생, 인터벌 훈련 활용 가능' : '신호등 있음 — 페이스 훈련보다 가볍게 즐기는 코스에 적합'}</div>
        </div>
      </div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">이 코스는 누구에게 잘 맞나요?</div>
      <div class="fit-list">${c.fit.map(f=>`<div class="fit-item ${f.good?'good':'warn'}">${f.good?'✓':'⚠'} ${f.text}</div>`).join('')}</div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">아쉬운 점</div>
      <div class="downside-list">${c.downsides.map(d=>`<div class="downside-item">${d}</div>`).join('')}</div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">한줄 후기</div>
      <div class="review-input-row">
        <input class="review-input" type="text" id="reviewInput" placeholder="오늘 뛰어봤어요. 한줄 남겨주세요!" maxlength="60">
        <button class="review-submit-btn" onclick="submitReview(${c.id})">등록</button>
      </div>
      <div class="review-list" id="reviewList"></div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">한줄 총평</div>
      <div class="total-review">"${c.review}"</div>
      <div class="quote-block">${getMotivationalQuote(c.id)}</div>
    </div>`;

  const btn = document.getElementById('detailSaveBtn');
  btn.className = 'detail-save-btn' + (isSaved?' saved':'');
  btn.textContent = isSaved ? '♥ 저장됨' : '♡ 저장하기';
  document.getElementById('detailOverlay').classList.add('open');

  // 지도에 경로 그리기
  showCourseRoute(id);
  // 초기 페이스 계산
  calcPace(c.km);
  // 후기 렌더링
  renderReviews(id);
}

// ── 페이스 계산기 ──
function setPaceLevel(btn, min, sec, km) {
  document.querySelectorAll('.pace-level-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('paceMin').value = min;
  document.getElementById('paceSec').value = sec;
  calcPace(km);
}

function calcPace(km) {
  const minEl = document.getElementById('paceMin');
  const secEl = document.getElementById('paceSec');
  if (!minEl || !secEl) return;
  const pacePerKm = (parseInt(minEl.value)||6) * 60 + (parseInt(secEl.value)||0);
  const totalSec = Math.round(pacePerKm * km);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const timeStr = h > 0
    ? `${h}시간 ${m}분`
    : `${m}분 ${s.toString().padStart(2,'0')}초`;
  const kcal = Math.round(km * 70 * 1.05);
  const burgers = (kcal / 550).toFixed(1);

  document.getElementById('paceResultTime').textContent = timeStr;
  document.getElementById('paceResultKcal').textContent = `${kcal} kcal`;
  document.getElementById('paceResultFood').textContent = `${burgers}개`;

  // 팁 메시지
  const paceMin = parseInt(minEl.value)||6;
  let tip = '';
  if (paceMin >= 8) tip = '💡 걷기보다 조금 빠른 페이스예요. 숨 편하게 대화 가능!';
  else if (paceMin === 7) tip = '💡 입문자 적정 페이스. 옆 사람과 짧은 대화 가능한 강도예요.';
  else if (paceMin === 6) tip = '💡 일반 러너 평균 페이스. 5km 대회 참가자 평균이에요.';
  else if (paceMin === 5) tip = '💡 10km 대회 입상권 수준. 꽤 빠른 페이스예요!';
  else if (paceMin <= 4) tip = '🔥 엘리트 수준! 하프마라톤 1시간 25분 페이스예요.';
  const tipEl = document.getElementById('paceTip');
  if (tipEl) tipEl.textContent = tip;
}

function closeDetail() { document.getElementById('detailOverlay').classList.remove('open'); }
function closeDetailOnBg(e) { if (e.target===document.getElementById('detailOverlay')) closeDetail(); }

function toggleDetailSave() {
  if (currentCourseId===null) return;
  const id = currentCourseId;
  const btn = document.getElementById('detailSaveBtn');
  if (savedCourses.includes(id)) {
    savedCourses = savedCourses.filter(x=>x!==id);
    btn.className='detail-save-btn'; btn.textContent='♡ 저장하기';
    showToast('저장이 취소됐어요');
  } else {
    savedCourses.push(id);
    btn.className='detail-save-btn saved'; btn.textContent='♥ 저장됨';
    if (firstSave) { firstSave=false; localStorage.setItem('rm_firstsave','1'); showToast('💾 이 기기에 저장됐어요. 브라우저 초기화 시 사라질 수 있어요.'); }
    else showToast('💾 이 기기에 저장됐어요');
  }
  saveState(); renderList();
}
function updateDetailSaveBtn() {
  if (currentCourseId===null) return;
  const isSaved = savedCourses.includes(currentCourseId);
  const btn = document.getElementById('detailSaveBtn');
  if (!btn) return;
  btn.className='detail-save-btn'+(isSaved?' saved':'');
  btn.textContent = isSaved?'♥ 저장됨':'♡ 저장하기';
}

// ── 기록 ──
function openRecordModal() {
  if (currentCourseId===null) return;
  document.getElementById('recordModalSub').textContent = COURSES.find(x=>x.id===currentCourseId)?.name;
  document.getElementById('recordDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('recordDuration').value='';
  document.getElementById('recordMemo').value='';
  recordStar=0; recordDiff=''; recordWant='';
  document.querySelectorAll('.diff-btn,.want-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.star').forEach(s=>s.classList.remove('on'));
  document.getElementById('recordModal').classList.add('open');
}
function closeRecordModal() { document.getElementById('recordModal').classList.remove('open'); }
function setDiff(btn) { document.querySelectorAll('.diff-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); recordDiff=btn.dataset.diff; }
function setStar(n) { recordStar=n; document.querySelectorAll('.star').forEach((s,i)=>s.classList.toggle('on',i<n)); }
function setWant(btn) { document.querySelectorAll('.want-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); recordWant=btn.dataset.want; }
function saveRecord() {
  const c = COURSES.find(x=>x.id===currentCourseId);
  if (!c) return;
  records.unshift({ id:'r'+Date.now(), courseId:c.id, courseName:c.name,
    date:document.getElementById('recordDate').value,
    duration:document.getElementById('recordDuration').value||'?',
    difficulty:recordDiff||'적당해', satisfaction:recordStar||3,
    wantAgain:recordWant!=='no', memo:document.getElementById('recordMemo').value });
  saveState(); closeRecordModal(); showToast('📋 기록이 저장됐어요!');
}

// ── 마이페이지 ──
let myTab='saved';
function openMyPage(tab) { myTab=tab; document.getElementById('mypageOverlay').classList.add('open'); switchMyTab(tab); }
function closeMyPage() { document.getElementById('mypageOverlay').classList.remove('open'); }
function renderMyPage() {
  const body=document.getElementById('mypageBody');
  const notice=`<div class="storage-notice">⚠ 이 기기에 저장된 정보예요. 브라우저 데이터를 삭제하면 사라질 수 있어요.</div>`;
  if (myTab==='saved') {
    if (!savedCourses.length) { body.innerHTML=notice+'<div class="mypage-empty">아직 저장한 코스가 없어요 ♡</div>'; return; }
    body.innerHTML=notice+`<div class="mypage-section-title">저장한 코스 (${savedCourses.length})</div>`+
      savedCourses.map(id=>{ const c=COURSES.find(x=>x.id===id); if(!c)return'';
        return `<div class="saved-course-item" onclick="openDetail(${id});closeMyPage()">
          <div><div class="saved-course-name">${c.name}</div><div class="saved-course-meta">${c.region} · ${c.km}km</div></div>
        </div>`; }).join('');
  }
  if (myTab==='recent') {
    if (!recentCourses.length) { body.innerHTML=notice+'<div class="mypage-empty">최근 본 코스가 없어요</div>'; return; }
    body.innerHTML=notice+`<div class="mypage-section-title">최근 본 코스 (${recentCourses.length})</div>`+
      recentCourses.map(id=>{ const c=COURSES.find(x=>x.id===id); if(!c)return'';
        return `<div class="saved-course-item" onclick="openDetail(${id});closeMyPage()">
          <div><div class="saved-course-name">${c.name}</div><div class="saved-course-meta">${c.region} · ${c.km}km</div></div>
        </div>`; }).join('');
  }
  if (myTab==='records') {
    if (!records.length) { body.innerHTML=notice+'<div class="mypage-empty">아직 기록이 없어요 📝</div>'; return; }
    const avg=Math.round(records.reduce((s,r)=>s+r.satisfaction,0)/records.length*10)/10;
    const want=records.filter(r=>r.wantAgain).length;
    body.innerHTML=notice+`<div class="summary-card">
      <div><div class="summary-num">${records.length}</div><div class="summary-label">총 기록</div></div>
      <div><div class="summary-num">⭐${avg}</div><div class="summary-label">평균 만족도</div></div>
      <div><div class="summary-num">${want}</div><div class="summary-label">다시 뛰고 싶은</div></div>
    </div>`+`<div class="mypage-section-title">내 기록 (${records.length})</div>`+
      records.map(r=>`<div class="record-item">
        <div class="record-name">${r.courseName}</div>
        <div class="record-meta">
          <span class="record-meta-item">📅 ${r.date}</span>
          <span class="record-meta-item">⏱ ${r.duration}분</span>
          <span class="record-meta-item">💪 ${r.difficulty}</span>
          <span class="record-meta-item">${r.wantAgain?'👍 또 뛰고 싶어':'😅 아직은 글쎄'}</span>
        </div>
        <div class="record-stars">${'★'.repeat(r.satisfaction)+'☆'.repeat(5-r.satisfaction)}</div>
        ${r.memo?`<div class="record-memo">"${r.memo}"</div>`:''}
      </div>`).join('');
  }
  if (myTab==='badge') {
    renderBadgeTab(body, notice);
  }
  if (myTab==='reports') {
    body.innerHTML = notice + '<div class="mypage-empty">불러오는 중...</div>';
    const typeLabel = { scenic:'🌅 경치좋음', quiet:'🌿 조용함', night:'🌙 야간러닝', workout:'💪 업다운' };
    sb.select('reports', 'order=created_at.desc&limit=50')
      .then(data => {
        if (!data || !data.length) {
          body.innerHTML = notice + '<div class="mypage-empty">아직 제보한 코스가 없어요<br>지도에서 + 버튼을 눌러 제보해보세요!</div>';
          return;
        }
        body.innerHTML = notice + `<div class="mypage-section-title">전체 제보 (${data.length}) — 검토 후 지도에 추가돼요</div>` +
          data.map(r => `
            <div class="record-item">
              <div class="record-name">${r.name}</div>
              <div class="record-meta">
                <span class="record-meta-item">📍 ${r.region}</span>
                <span class="record-meta-item">🏃 ${r.km}km</span>
                <span class="record-meta-item">${typeLabel[r.type]||r.type}</span>
                <span class="record-meta-item" style="color:${r.status==='approved'?'var(--accent)':'var(--text3)'}">
                  ${r.status==='approved'?'✅ 승인됨':'⏳ 검토 중'}
                </span>
              </div>
              <div class="record-memo">"${r.description}"</div>
            </div>`).join('');
      }).catch(() => {
        body.innerHTML = notice + '<div class="mypage-empty">제보 목록을 불러오지 못했어요</div>';
      });
  }
}

// ── 후기 ──
function getReviews(courseId) {
  return JSON.parse(localStorage.getItem('rm_reviews_' + courseId) || '[]');
}
async function renderReviews(courseId) {
  const list = document.getElementById('reviewList');
  if (!list) return;
  list.innerHTML = '<div class="review-empty">불러오는 중...</div>';
  try {
    const data = await sb.select('reviews', `course_id=eq.${courseId}&order=created_at.desc&limit=20`);
    if (!data || !data.length) {
      list.innerHTML = '<div class="review-empty">아직 후기가 없어요. 첫 번째로 남겨주세요!</div>';
      return;
    }
    list.innerHTML = data.map(r => {
      const date = new Date(r.created_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
      return `<div class="review-item">
        <div class="review-item-text">${r.text}</div>
        <div class="review-item-meta">${date}</div>
      </div>`;
    }).join('');
  } catch(e) {
    list.innerHTML = '<div class="review-empty">후기를 불러오지 못했어요</div>';
  }
}
async function submitReview(courseId) {
  const input = document.getElementById('reviewInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  try {
    await sb.insert('reviews', { course_id: courseId, text });
    renderReviews(courseId);
    checkBadges();
    showToast('후기가 등록됐어요 👍');
  } catch(e) {
    showToast('등록 실패. 다시 시도해주세요');
  }
}

// ── 뱃지 정의 ──
const BADGES = [
  { id: 'first_run',   icon: '🏃', name: '첫 발걸음',   cond: '기록 1개',       check: (r,s) => r >= 1 },
  { id: 'five_runs',   icon: '🔥', name: '꾸준한 러너', cond: '기록 5개',       check: (r,s) => r >= 5 },
  { id: 'ten_runs',    icon: '💎', name: '러닝 중독자', cond: '기록 10개',      check: (r,s) => r >= 10 },
  { id: 'saver',       icon: '❤️', name: '코스 수집가', cond: '저장 3개',       check: (r,s) => s >= 3 },
  { id: 'explorer',    icon: '🗺️', name: '탐험가',      cond: '저장 5개',       check: (r,s) => s >= 5 },
  { id: 'reviewer',    icon: '✍️', name: '후기왕',      cond: '후기 3개',       check: (r,s,rv) => rv >= 3 },
  { id: 'night_owl',   icon: '🌙', name: '야간 러너',   cond: 'night 코스 기록', check: (r,s,rv,types) => types.includes('night') },
  { id: 'mountain',    icon: '⛰️', name: '업힐 정복자', cond: 'workout 코스 기록', check: (r,s,rv,types) => types.includes('workout') },
];
function getBadgeStats() {
  const recordCount = records.length;
  const savedCount = savedCourses.length;
  let reviewCount = 0;
  COURSES.forEach(c => { reviewCount += getReviews(c.id).length; });
  const runTypes = records.map(r => {
    const c = COURSES.find(x => x.id === r.courseId);
    return c ? c.type : '';
  });
  return { recordCount, savedCount, reviewCount, runTypes };
}
function checkBadges() {
  const { recordCount, savedCount, reviewCount, runTypes } = getBadgeStats();
  const earned = JSON.parse(localStorage.getItem('rm_badges') || '[]');
  let newBadge = false;
  BADGES.forEach(b => {
    if (!earned.includes(b.id) && b.check(recordCount, savedCount, reviewCount, runTypes)) {
      earned.push(b.id);
      newBadge = true;
      showToast('🏅 새 뱃지 획득! ' + b.name);
    }
  });
  if (newBadge) localStorage.setItem('rm_badges', JSON.stringify(earned));
  return earned;
}
function renderBadgeTab(body, notice) {
  const earned = checkBadges();
  const { recordCount, savedCount, reviewCount } = getBadgeStats();
  body.innerHTML = notice + `
    <div class="badge-summary">
      <div class="badge-summary-stat">
        <div class="badge-summary-num">${recordCount}</div>
        <div class="badge-summary-label">총 기록</div>
      </div>
      <div class="badge-summary-stat">
        <div class="badge-summary-num">${savedCount}</div>
        <div class="badge-summary-label">저장</div>
      </div>
      <div class="badge-summary-stat">
        <div class="badge-summary-num">${earned.length}</div>
        <div class="badge-summary-label">획득 뱃지</div>
      </div>
    </div>
    <div class="badge-how-to">
      <div class="badge-how-title">🏅 뱃지는 이렇게 얻어요</div>
      <div class="badge-how-list">
        <div class="badge-how-item">📝 <b>기록 남기기</b> — 코스 상세 → "기록 남기기" 버튼</div>
        <div class="badge-how-item">❤️ <b>코스 저장</b> — 코스 상세 → "저장하기" 버튼</div>
        <div class="badge-how-item">✍️ <b>한줄 후기</b> — 코스 상세 → 후기 입력란</div>
      </div>
    </div>
    <div class="mypage-section-title">내 뱃지 (${earned.length}/${BADGES.length})</div>
    <div class="badge-grid">
      ${BADGES.map(b => {
        const isEarned = earned.includes(b.id);
        return `<div class="badge-item ${isEarned ? 'earned' : 'locked'}">
          <div class="badge-icon">${isEarned ? b.icon : '🔒'}</div>
          <div class="badge-name">${b.name}</div>
          <div class="badge-cond">${isEarned ? '✅ 획득 완료' : b.cond}</div>
        </div>`;
      }).join('')}
    </div>`;
}

// ── 제보 모달 ──
let selectedReportType = '';
function openReportModal() {
  document.getElementById('reportOverlay').classList.add('open');
}
function closeReportModal() {
  document.getElementById('reportOverlay').classList.remove('open');
}
function closeReportOnBg(e) {
  if (e.target === document.getElementById('reportOverlay')) closeReportModal();
}
function selectReportType(btn, type) {
  document.querySelectorAll('.report-type-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedReportType = type;
}
async function submitReport() {
  const name = document.getElementById('rName').value.trim();
  const region = document.getElementById('rRegion').value.trim();
  const address = document.getElementById('rAddress').value.trim();
  const km = parseFloat(document.getElementById('rKm').value);
  const description = document.getElementById('rDesc').value.trim();
  const extra = document.getElementById('rExtra').value.trim();

  if (!name || !region || !address || !km || !selectedReportType || !description) {
    showToast('* 표시 항목을 모두 입력해주세요!'); return;
  }

  const btn = document.querySelector('.report-google-btn');
  btn.textContent = '등록 중...';
  btn.disabled = true;

  try {
    await sb.insert('reports', {
      name, region, address, km,
      type: selectedReportType,
      description, extra, status: 'pending'
    });

    // 폼 초기화
    ['rName','rRegion','rAddress','rKm','rDesc','rExtra'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.querySelectorAll('.report-type-btn').forEach(b => b.classList.remove('selected'));
    selectedReportType = '';
    closeReportModal();
    showToast('제보 감사해요! 검토 후 지도에 추가할게요 🙏');
  } catch(e) {
    showToast('제보 실패. 다시 시도해주세요');
  } finally {
    btn.textContent = '📍 제보 등록하기';
    btn.disabled = false;
  }
}

// ── switchMyTab 업데이트 (badge 탭 포함) ──
function switchMyTab(tab) {
  myTab = tab;
  ['saved','recent','records','badge','reports'].forEach(t => {
    const el = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (el) el.classList.toggle('active', t === tab);
  });
  renderMyPage();
}

// ── 검색 + 정렬 ──
let sortByLocation = false;
let myLat = null, myLng = null;

function toggleSort() {
  sortByLocation = !sortByLocation;
  document.getElementById('sortBtn').classList.toggle('active', sortByLocation);
  if (sortByLocation && !myLat) {
    navigator.geolocation.getCurrentPosition(pos => {
      myLat = pos.coords.latitude;
      myLng = pos.coords.longitude;
      renderList();
      fetchWeather(myLat, myLng);
    }, () => { sortByLocation = false; document.getElementById('sortBtn').classList.remove('active'); showToast('위치 권한이 필요해요'); });
  } else {
    renderList();
  }
}

function calcDist(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── 날씨 ──
async function fetchWeather(lat, lng) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true&timezone=Asia%2FSeoul`);
    const data = await res.json();
    const w = data.current_weather;
    const code = w.weathercode;
    const temp = Math.round(w.temperature);
    const icon = code <= 1 ? '☀️' : code <= 3 ? '⛅' : code <= 67 ? '🌧️' : code <= 77 ? '🌨️' : '🌩️';
    const msg = code <= 1 ? '러닝하기 딱 좋은 날씨!' : code <= 3 ? '흐리지만 뛸 만해요' : '우비 챙기세요 🌧️';
    document.getElementById('weatherChip').innerHTML = `${icon} ${temp}°C · ${msg}`;
  } catch(e) {}
}

// ── 공유 ──
function shareCurrentCourse() {
  const c = COURSES.find(x => x.id === currentCourseId);
  if (!c) return;
  const url = `${location.origin}${location.pathname}?course=${c.id}`;
  const text = `[러너맵] ${c.name} · ${c.km}km\n${c.desc}\n${url}`;
  if (navigator.share) {
    navigator.share({ title: c.name, text: c.desc, url });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('링크가 복사됐어요! 카카오톡에 붙여넣어 공유해보세요 🔗'));
  } else {
    showToast('공유: ' + url);
  }
}

// ── URL 파라미터로 코스 자동 오픈 ──
function checkUrlCourse() {
  const params = new URLSearchParams(location.search);
  const id = parseInt(params.get('course'));
  if (!isNaN(id) && COURSES.find(x => x.id === id)) {
    setTimeout(() => openDetail(id), 800);
  }
}

// ── 토스트 ──
function showToast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2800);
}
