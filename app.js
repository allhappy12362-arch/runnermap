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

// OSRM 라우팅 캐시 — 같은 코스 반복 클릭 시 API 재호출 방지
const _osrmCache = {};

async function showCourseRoute(id) {
  if (!kakaoMap) return;
  const c = COURSES.find(x => x.id === id);
  if (!c || !c.path || !c.path.length) return;

  clearRouteOverlay();

  const colorMap = { scenic: '#4d9fff', quiet: '#9d7fff', night: '#ff9d3d', workout: '#ff4d4d' };
  const color = colorMap[c.type] || '#c8ff00';

  // 로딩 표시
  document.getElementById('routeInfoKm').textContent = '경로 불러오는 중...';
  document.getElementById('routeInfoName').textContent = c.name;
  document.getElementById('routeInfoOverlay').classList.add('visible');

  let linePath;

  try {
    // 캐시 확인
    if (_osrmCache[id]) {
      linePath = _osrmCache[id];
    } else {
      // OSRM foot 라우팅 API — 경유 웨이포인트 모두 사용
      // 웨이포인트가 너무 많으면 URL이 길어지므로 최대 25개로 균등 샘플링
      let waypoints = c.path;
      if (waypoints.length > 25) {
        const step = (waypoints.length - 1) / 24;
        waypoints = Array.from({length: 25}, (_, i) => waypoints[Math.round(i * step)]);
      }
      const coords = waypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/foot/${coords}?overview=full&geometries=geojson`;

      const res = await fetch(url);
      if (!res.ok) throw new Error('OSRM 응답 오류');
      const data = await res.json();

      if (data.code !== 'Ok' || !data.routes?.length) throw new Error('경로 없음');

      // GeoJSON coordinates: [lng, lat] → kakao.maps.LatLng(lat, lng)
      linePath = data.routes[0].geometry.coordinates.map(
        ([lng, lat]) => new kakao.maps.LatLng(lat, lng)
      );
      _osrmCache[id] = linePath;
    }
  } catch (e) {
    // OSRM 실패 시 원본 path 직선 폴백
    console.warn('OSRM 실패, 직선 경로로 표시:', e.message);
    linePath = c.path.map(([lat, lng]) => new kakao.maps.LatLng(lat, lng));
  }

  // Polyline 그리기
  activePolyline = new kakao.maps.Polyline({
    map: kakaoMap,
    path: linePath,
    strokeWeight: 5,
    strokeColor: color,
    strokeOpacity: 0.88,
    strokeStyle: 'solid'
  });

  // 출발 마커
  const startContent = `<div style="display:flex;flex-direction:column;align-items:center">
    <div style="background:#0d0d0d;border:1.5px solid #c8ff00;border-radius:20px;padding:2px 8px;font-size:10px;color:#c8ff00;font-family:'Noto Sans KR',sans-serif;margin-bottom:3px;white-space:nowrap;">▶ 출발</div>
    <div style="width:10px;height:10px;border-radius:50%;background:#c8ff00;border:2px solid #0d0d0d;"></div>
  </div>`;
  const startOverlay = new kakao.maps.CustomOverlay({ position: linePath[0], content: startContent, yAnchor: 1 });
  startOverlay.setMap(kakaoMap);
  activeRouteMarkers.push(startOverlay);

  // 도착 마커
  const endPt = linePath[linePath.length - 1];
  const endContent = `<div style="display:flex;flex-direction:column;align-items:center">
    <div style="background:#0d0d0d;border:1.5px solid ${color};border-radius:20px;padding:2px 8px;font-size:10px;color:${color};font-family:'Noto Sans KR',sans-serif;margin-bottom:3px;white-space:nowrap;">■ 도착</div>
    <div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #0d0d0d;"></div>
  </div>`;
  const endOverlay = new kakao.maps.CustomOverlay({ position: endPt, content: endContent, yAnchor: 1 });
  endOverlay.setMap(kakaoMap);
  activeRouteMarkers.push(endOverlay);

  // 전체 경로 보이게 줌 조정
  const bounds = new kakao.maps.LatLngBounds();
  linePath.forEach(p => bounds.extend(p));
  kakaoMap.setBounds(bounds, 60);

  // route info 업데이트
  document.getElementById('routeInfoKm').textContent = c.km + 'km';
  document.getElementById('routeInfoName').textContent = c.name;
}

function clearRouteOverlay() {
  if (activePolyline) { activePolyline.setMap(null); activePolyline = null; }
  activeRouteMarkers.forEach(m => m.setMap(null));
  activeRouteMarkers = [];
  document.getElementById('routeInfoOverlay').classList.remove('visible');
}

let myLocationOverlay = null;

function moveToMyLocation() {
  if (!kakaoMap) return;
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      myLat = lat; myLng = lng; // 러닝 시작 시 재사용
      const myPos = new kakao.maps.LatLng(lat, lng);
      kakaoMap.setCenter(myPos);
      kakaoMap.setLevel(4);

      // 기존 내 위치 마커 제거
      if (myLocationOverlay) myLocationOverlay.setMap(null);

      // 큰 펄스 + 십자 마커
      const content = `
        <div style="position:relative;width:60px;height:60px;display:flex;align-items:center;justify-content:center;pointer-events:none;">
          <!-- 펄스 애니메이션 원 -->
          <div style="position:absolute;width:60px;height:60px;border-radius:50%;
            background:rgba(200,255,0,0.18);
            animation:myLocPulse 1.6s ease-out infinite;"></div>
          <div style="position:absolute;width:40px;height:40px;border-radius:50%;
            background:rgba(200,255,0,0.28);
            animation:myLocPulse 1.6s ease-out infinite 0.3s;"></div>
          <!-- 중심 원 -->
          <div style="position:relative;z-index:2;width:18px;height:18px;border-radius:50%;
            background:#c8ff00;border:3px solid #0d0d0d;
            box-shadow:0 0 0 3px rgba(200,255,0,0.5),0 2px 10px rgba(0,0,0,0.6);"></div>
          <!-- 십자선 -->
          <div style="position:absolute;top:50%;left:0;right:0;height:1.5px;
            background:rgba(200,255,0,0.55);transform:translateY(-50%);z-index:1;"></div>
          <div style="position:absolute;left:50%;top:0;bottom:0;width:1.5px;
            background:rgba(200,255,0,0.55);transform:translateX(-50%);z-index:1;"></div>
        </div>
        <style>
          @keyframes myLocPulse {
            0%   { transform:scale(0.5); opacity:0.9; }
            100% { transform:scale(1.6); opacity:0; }
          }
        </style>`;

      myLocationOverlay = new kakao.maps.CustomOverlay({
        position: myPos,
        content,
        zIndex: 10,
        yAnchor: 0.5,
        xAnchor: 0.5
      });
      myLocationOverlay.setMap(kakaoMap);
    }, () => { showToast('위치 권한이 필요해요 🙏'); });
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
      <div class="pace-calc-sub">내 속도를 선택하면 완주 시간과 칼로리를 계산해드려요</div>
      <div class="pace-level-row">
        <button class="pace-level-btn active" onclick="setPaceLevel(this,7,0,${c.km})" data-label="🚶 초보">
          🚶 처음이에요
          <span>1km에 7분</span>
        </button>
        <button class="pace-level-btn" onclick="setPaceLevel(this,6,0,${c.km})" data-label="🏃 보통">
          🏃 가끔 뛰어요
          <span>1km에 6분</span>
        </button>
        <button class="pace-level-btn" onclick="setPaceLevel(this,5,0,${c.km})" data-label="💨 빠름">
          💨 자주 뛰어요
          <span>1km에 5분</span>
        </button>
        <button class="pace-level-btn" onclick="setPaceLevel(this,4,0,${c.km})" data-label="🔥 고수">
          🔥 매일 뛰어요
          <span>1km에 4분</span>
        </button>
      </div>
      <div class="pace-custom-row">
        <span class="pace-label">1km 달리는 데</span>
        <input class="pace-input" type="number" id="paceMin" value="7" min="3" max="15" style="max-width:48px" oninput="calcPace(${c.km})">
        <span class="pace-sep">분</span>
        <input class="pace-input" type="number" id="paceSec" value="0" min="0" max="59" style="max-width:48px" oninput="calcPace(${c.km})">
        <span class="pace-sep">초 걸려요</span>
      </div>
      <div class="pace-result-cards">
        <div class="pace-card main">
          <div class="pace-card-icon">⏰</div>
          <div class="pace-card-value" id="paceResultTime">—</div>
          <div class="pace-card-label">완주까지 걸리는 시간</div>
        </div>
        <div class="pace-card">
          <div class="pace-card-icon">🔥</div>
          <div class="pace-card-value" id="paceResultKcal">—</div>
          <div class="pace-card-label">소모 칼로리 (체중 65kg 기준)</div>
        </div>
        <div class="pace-card">
          <div class="pace-card-icon">🍔</div>
          <div class="pace-card-value" id="paceResultFood">—</div>
          <div class="pace-card-label">햄버거로 따지면</div>
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

  const paceMin = parseInt(minEl.value) || 7;
  const paceSec = parseInt(secEl.value) || 0;
  const pacePerKm = paceMin * 60 + paceSec; // 초/km
  const totalSec = Math.round(pacePerKm * km);

  // 완주 시간 포맷
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const timeStr = h > 0
    ? `${h}시간 ${m}분`
    : `${m}분 ${s.toString().padStart(2,'0')}초`;

  // ── 칼로리 계산: 거리 기반 공식 + 페이스 강도 보정 ──
  // 기본: 체중 × 거리 × 1.036 (널리 검증된 러닝 칼로리 공식)
  // 강도 보정: 빠를수록 산소소비량 증가 → 최대 15% 추가
  const weight = 65;
  const baseKcal = weight * km * 1.036;
  const speedKmh = 60 / (paceMin + paceSec / 60);
  // 속도 6km/h(10분페이스)~16km/h(3분45초페이스) 기준 0~15% 보정
  const intensityBonus = Math.min(0.15, Math.max(0, (speedKmh - 6) / 10 * 0.15));
  const kcal = Math.round(baseKcal * (1 + intensityBonus));
  const burgers = (kcal / 550).toFixed(1);

  document.getElementById('paceResultTime').textContent = timeStr;
  document.getElementById('paceResultKcal').textContent = `${kcal} kcal`;
  document.getElementById('paceResultFood').textContent = `${burgers}개`;

  // ── 쉬운 팁 메시지 ──
  const tipEl = document.getElementById('paceTip');
  if (!tipEl) return;
  let tip = '';
  if (paceMin >= 8)      tip = '💡 대화하면서 편하게 뛸 수 있는 속도예요. 처음 시작하기 딱 좋아요!';
  else if (paceMin === 7) tip = '💡 숨이 약간 차지만 옆 사람이랑 짧은 대화는 가능한 속도예요.';
  else if (paceMin === 6) tip = '💡 운동 효과가 확실히 느껴지는 속도예요. 대화는 힘들어요.';
  else if (paceMin === 5) tip = '💪 꽤 빠른 속도예요! 숨이 많이 차고 온몸에 땀이 나는 강도예요.';
  else if (paceMin <= 4)  tip = '🔥 엘리트 선수 수준이에요. 이 속도라면 대회 입상도 가능해요!';
  tipEl.textContent = tip;
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
// ── 제보 지도 상태 ──
let reportMap = null;
let reportWaypoints = [];
let reportPolyline = null;
let reportDotOverlays = [];
let reportOsrmPath = [];
let reportMultiSelected = new Set(); // 분위기+편의시설 복수선택

function openReportModal() {
  document.getElementById('reportOverlay').classList.add('open');
  // 카카오맵 로드된 후 제보 지도 초기화 — 시트 애니메이션(0.25s) 후 실행
  setTimeout(() => initReportMap(), 350);
}

function initReportMap() {
  if (!kakaoReady()) {
    // 카카오 SDK 아직 로드 안 됐으면 재시도
    setTimeout(() => initReportMap(), 500);
    return;
  }

  const container = document.getElementById('reportMap');
  if (!container) return;

  // 이미 지도 있으면 relayout만 호출 (크기 재계산)
  if (reportMap) {
    kakao.maps.event.trigger(reportMap, 'resize');
    return;
  }

  const center = kakaoMap
    ? kakaoMap.getCenter()
    : new kakao.maps.LatLng(37.5326, 127.0246);

  reportMap = new kakao.maps.Map(container, {
    center,
    level: 5,
    mapTypeId: kakao.maps.MapTypeId.ROADMAP
  });

  // 지도 클릭 → 웨이포인트 추가
  kakao.maps.event.addListener(reportMap, 'click', e => {
    const lat = e.latLng.getLat();
    const lng = e.latLng.getLng();
    addReportWaypoint(lat, lng);
  });
}

function addReportWaypoint(lat, lng) {
  reportWaypoints.push([lat, lng]);
  const idx = reportWaypoints.length;

  // 점 오버레이 (번호 표시)
  const isFirst = idx === 1;
  const dotContent = `<div style="
    width:22px;height:22px;border-radius:50%;
    background:${isFirst ? '#c8ff00' : '#fff'};
    border:2px solid #0d0d0d;
    font-size:10px;font-weight:700;color:#0d0d0d;
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 1px 6px rgba(0,0,0,0.5);
    font-family:'DM Mono',monospace;
  ">${idx}</div>`;

  const dot = new kakao.maps.CustomOverlay({
    position: new kakao.maps.LatLng(lat, lng),
    content: dotContent,
    yAnchor: 0.5, xAnchor: 0.5, zIndex: 5
  });
  dot.setMap(reportMap);
  reportDotOverlays.push(dot);

  // 힌트 텍스트 업데이트
  const hint = document.getElementById('reportMapHint');
  if (idx === 1) hint.textContent = '계속 탭해서 경유점을 추가하세요';
  else if (idx >= 2) hint.textContent = `${idx}개 경유점 · 탭해서 추가`;

  // 2점 이상이면 OSRM 경로 그리기
  if (reportWaypoints.length >= 2) drawReportRoute();
}

async function drawReportRoute() {
  if (reportWaypoints.length < 2) return;

  // 기존 polyline 제거
  if (reportPolyline) { reportPolyline.setMap(null); reportPolyline = null; }

  try {
    const coords = reportWaypoints.map(([lat, lng]) => `${lng},${lat}`).join(';');
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/foot/${coords}?overview=full&geometries=geojson`
    );
    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('경로 없음');

    const geo = data.routes[0].geometry.coordinates;
    reportOsrmPath = geo.map(([lng, lat]) => [lat, lng]); // 저장용 [lat,lng]
    const linePath = geo.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng));

    reportPolyline = new kakao.maps.Polyline({
      map: reportMap,
      path: linePath,
      strokeWeight: 4,
      strokeColor: '#c8ff00',
      strokeOpacity: 0.9,
      strokeStyle: 'solid'
    });

    // 거리 계산 (m → km)
    const distM = data.routes[0].distance;
    const km = (distM / 1000).toFixed(1);
    document.getElementById('reportMapDist').textContent = km + ' km';
    document.getElementById('rKm').value = km;

    // 경로 전체 보이게
    const bounds = new kakao.maps.LatLngBounds();
    linePath.forEach(p => bounds.extend(p));
    reportMap.setBounds(bounds, 30);

  } catch(e) {
    // 폴백: 직선 연결
    const linePath = reportWaypoints.map(([lat, lng]) => new kakao.maps.LatLng(lat, lng));
    reportOsrmPath = [...reportWaypoints];
    reportPolyline = new kakao.maps.Polyline({
      map: reportMap, path: linePath,
      strokeWeight: 4, strokeColor: '#c8ff00', strokeOpacity: 0.7
    });
  }
}

function reportMapUndo() {
  if (!reportWaypoints.length) return;
  reportWaypoints.pop();
  const dot = reportDotOverlays.pop();
  if (dot) dot.setMap(null);
  if (reportPolyline) { reportPolyline.setMap(null); reportPolyline = null; }
  reportOsrmPath = [];

  const hint = document.getElementById('reportMapHint');
  if (reportWaypoints.length === 0) {
    hint.textContent = '지도를 탭해서 경유점을 찍어주세요';
    document.getElementById('reportMapDist').textContent = '0.0 km';
    document.getElementById('rKm').value = '';
  } else if (reportWaypoints.length >= 2) {
    hint.textContent = `${reportWaypoints.length}개 경유점`;
    drawReportRoute();
  } else {
    hint.textContent = '계속 탭해서 경유점을 추가하세요';
    document.getElementById('reportMapDist').textContent = '0.0 km';
  }
}

function toggleReportMulti(btn) {
  const key = btn.dataset.key;
  if (reportMultiSelected.has(key)) {
    reportMultiSelected.delete(key);
    btn.classList.remove('selected');
  } else {
    reportMultiSelected.add(key);
    btn.classList.add('selected');
  }
}

function reportMapReset() {
  reportWaypoints = [];
  reportDotOverlays.forEach(d => d.setMap(null));
  reportDotOverlays = [];
  if (reportPolyline) { reportPolyline.setMap(null); reportPolyline = null; }
  reportOsrmPath = [];
  document.getElementById('reportMapDist').textContent = '0.0 km';
  document.getElementById('rKm').value = '';
  document.getElementById('reportMapHint').textContent = '지도를 탭해서 경유점을 찍어주세요';
  // reportMap 객체는 유지
}


function closeReportModal() {
  document.getElementById('reportOverlay').classList.remove('open');
  reportMapReset();
  reportMultiSelected.clear();
  document.querySelectorAll('.report-multi-btn').forEach(b => b.classList.remove('selected'));
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
  const km = parseFloat(document.getElementById('rKm').value);
  const description = document.getElementById('rDesc').value.trim();

  if (!name || !km || !selectedReportType || !description) {
    showToast('* 표시 항목을 모두 입력해주세요!'); return;
  }
  if (reportWaypoints.length < 2) {
    showToast('지도에 경로를 먼저 그려주세요! 🗺️'); return;
  }

  const pathToSave = reportOsrmPath.length >= 2 ? reportOsrmPath : reportWaypoints;
  const startLat = reportWaypoints[0][0];
  const startLng = reportWaypoints[0][1];

  // 분위기 키 목록
  const vibeKeys = ['scenic','quiet','night','workout','crowd','solo','flat','photo'];
  // 편의시설 키 목록
  const facilityKeys = ['toilet','water','store','spot','parking','nosignal','light','bench'];

  const vibes = {};
  vibeKeys.forEach(k => { vibes[k] = reportMultiSelected.has(k); });

  const facilities = {};
  facilityKeys.forEach(k => { facilities[k] = reportMultiSelected.has(k); });
  facilities.signal = reportMultiSelected.has('nosignal') ? '신호등 없음' : '신호등 있음';

  const btn = document.querySelector('.report-google-btn');
  btn.textContent = '등록 중...';
  btn.disabled = true;

  try {
    await sb.insert('reports', {
      name, km,
      type: selectedReportType,
      description,
      status: 'pending',
      lat: startLat,
      lng: startLng,
      path: JSON.stringify(pathToSave),
      vibes: JSON.stringify(vibes),
      facilities: JSON.stringify(facilities)
    });

    // 폼 초기화
    ['rName','rKm','rDesc'].forEach(id => { document.getElementById(id).value = ''; });
    document.querySelectorAll('.report-type-btn').forEach(b => b.classList.remove('selected'));
    document.querySelectorAll('.report-multi-btn').forEach(b => b.classList.remove('selected'));
    selectedReportType = '';
    reportMultiSelected.clear();
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


// ═══════════════════════════════════════════════════════
//  러닝 기록 모드
// ═══════════════════════════════════════════════════════
let runLinkedCourse = null; // 코스 상세에서 시작할 때 연결된 코스

// ── 코스 상세에서 러닝 시작 ──
function startRunWithCourse() {
  if (!kakaoReady()) { showToast('지도 로딩 중이에요 🙏'); return; }
  if (!navigator.geolocation) { showToast('이 기기는 GPS를 지원하지 않아요'); return; }

  const c = COURSES.find(x => x.id === currentCourseId);
  if (!c) return;

  runLinkedCourse = c;
  closeDetail();
  setTimeout(() => startRunMode(), 300);
}

// ── 카카오맵 준비 확인 헬퍼 ──
function kakaoReady() {
  return typeof kakao !== 'undefined' && kakao.maps && kakao.maps.Map;
}

let runReadyMap = null;
let runReadyLocOverlay = null;
let runReadyLat = null;
let runReadyLng = null;

// ── 준비화면 지도 초기화 ──
function initRunReadyMap() {
  if (!kakaoReady()) return;
  const container = document.getElementById('runReadyMap');
  if (!container) return;

  if (runReadyMap) {
    runReadyMap.relayout();
    return;
  }

  const center = kakaoMap
    ? kakaoMap.getCenter()
    : new kakao.maps.LatLng(37.5326, 127.0246);

  runReadyMap = new kakao.maps.Map(container, {
    center, level: 4,
    mapTypeId: kakao.maps.MapTypeId.ROADMAP
  });
}

// ── 내 위치 확인 버튼 ──
function locateForRun() {
  const locBtn = document.getElementById('runReadyLocBtn');
  locBtn.textContent = '📡 위치 잡는 중...';
  locBtn.classList.add('locating');
  locBtn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    pos => {
      runReadyLat = pos.coords.latitude;
      runReadyLng = pos.coords.longitude;

      // 지도 이동
      const latlng = new kakao.maps.LatLng(runReadyLat, runReadyLng);
      runReadyMap.setCenter(latlng);
      runReadyMap.setLevel(3);

      // 기존 마커 제거
      if (runReadyLocOverlay) runReadyLocOverlay.setMap(null);

      // 🏃 뛰는 사람 SVG 마커
      const runnerSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="44" height="56" viewBox="0 0 44 56"
          style="filter:drop-shadow(0 3px 8px rgba(0,0,0,0.6));display:block">
          <!-- 핀 몸통 -->
          <circle cx="22" cy="20" r="20" fill="#c8ff00"/>
          <circle cx="22" cy="20" r="20" fill="none" stroke="rgba(0,0,0,0.15)" stroke-width="1.5"/>
          <!-- 핀 꼬리 -->
          <polygon points="22,40 15,50 29,50" fill="#c8ff00"/>
          <!-- 달리는 사람 (검정) -->
          <!-- 머리 -->
          <circle cx="25" cy="9" r="3.5" fill="#0d0d0d"/>
          <!-- 몸통 -->
          <line x1="24" y1="13" x2="20" y2="22" stroke="#0d0d0d" stroke-width="2.5" stroke-linecap="round"/>
          <!-- 팔 앞 -->
          <line x1="23" y1="15" x2="30" y2="12" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
          <!-- 팔 뒤 -->
          <line x1="22" y1="16" x2="16" y2="19" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
          <!-- 다리 앞 -->
          <line x1="20" y1="22" x2="28" y2="29" stroke="#0d0d0d" stroke-width="2.2" stroke-linecap="round"/>
          <!-- 다리 뒤 -->
          <line x1="20" y1="22" x2="14" y2="27" stroke="#0d0d0d" stroke-width="2.2" stroke-linecap="round"/>
        </svg>`;

      runReadyLocOverlay = new kakao.maps.CustomOverlay({
        position: latlng,
        content: `<div style="cursor:default">${runnerSvg}</div>`,
        yAnchor: 1.1, xAnchor: 0.5, zIndex: 10
      });
      runReadyLocOverlay.setMap(runReadyMap);

      // 힌트 + 버튼 업데이트
      document.getElementById('runReadyMapHint').textContent = '✅ 위치 확인됐어요! 시작하기를 눌러주세요';
      locBtn.textContent = '📍 위치 다시 잡기';
      locBtn.classList.remove('locating');
      locBtn.disabled = false;

      // 시작 버튼 활성화
      const startBtn = document.getElementById('runReadyStartBtn');
      startBtn.disabled = false;
      startBtn.style.background = '';
    },
    err => {
      locBtn.textContent = '📍 내 위치 확인';
      locBtn.classList.remove('locating');
      locBtn.disabled = false;
      if (err.code === 1) showToast('위치 권한을 허용해주세요 🙏');
      else showToast('GPS 신호가 약해요. 야외로 이동 후 다시 시도해주세요');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
  );
}


let runPolyline = null;
let runLocOverlay = null;
let runPath = [];           // [[lat,lng], ...]
let runWatchId = null;
let runStartTime = null;
let runPauseTime = null;    // 누적 일시정지 ms
let runPauseStart = null;   // 현재 일시정지 시작
let runTimerInterval = null;
let runTotalDist = 0;       // km
let runIsPaused = false;
let runIsActive = false;
let runWakeLock = null;

// ── 러닝 모드 시작 (준비화면) ──
function startRunMode() {
  if (!kakaoReady()) { showToast('지도 로딩 중이에요 🙏'); return; }
  if (!navigator.geolocation) { showToast('이 기기는 GPS를 지원하지 않아요'); return; }

  // 버튼 상태 초기화
  const btn = document.getElementById('runReadyStartBtn');
  btn.textContent = '▶ 시작하기';
  btn.disabled = false;

  // 이미 메인 지도에서 위치 잡혀있으면 그대로 사용
  if (myLocationOverlay && myLat && myLng) {
    runReadyLat = myLat;
    runReadyLng = myLng;
    document.getElementById('runReadyMapHint').textContent = '✅ 내 위치 확인됐어요. 바로 시작할 수 있어요!';
  } else {
    runReadyLat = null; runReadyLng = null;
    document.getElementById('runReadyMapHint').textContent = 'GPS로 내 위치를 잡은 뒤 바로 시작돼요';
  }

  // 바텀시트 열기
  document.getElementById('runReadyBackdrop').classList.add('show');
  document.getElementById('runReadySheet').classList.add('show');
}


// ── 시작하기 버튼 → GPS 잡고 즉시 시작 ──
function startRunNow() {
  const btn = document.getElementById('runReadyStartBtn');
  btn.textContent = '📡 GPS 잡는 중...';
  btn.disabled = true;

  // 메인 지도에서 이미 내 위치 잡혀있으면 바로 시작
  if (myLat && myLng) {
    runReadyLat = myLat;
    runReadyLng = myLng;
    cancelRunMode();
    setTimeout(() => confirmStartRun(), 200);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      runReadyLat = pos.coords.latitude;
      runReadyLng = pos.coords.longitude;
      myLat = runReadyLat;
      myLng = runReadyLng;
      cancelRunMode();
      setTimeout(() => confirmStartRun(), 200);
    },
    err => {
      btn.textContent = '▶ 시작하기';
      btn.disabled = false;
      if (err.code === 1) showToast('위치 권한을 허용해주세요 🙏');
      else showToast('GPS 신호가 약해요. 야외로 이동 후 다시 시도해주세요');
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
  );
}

function cancelRunMode() {
  document.getElementById('runReadyBackdrop').classList.remove('show');
  document.getElementById('runReadySheet').classList.remove('show');
}

// ── 실제 시작 (시작하기 버튼 클릭 후) ──
function confirmStartRun() {
  // 바텀시트 닫기
  document.getElementById('runReadyBackdrop').classList.remove('show');
  document.getElementById('runReadySheet').classList.remove('show');

  // 초기화
  // 이전 GPS watch 정리
  if (runWatchId !== null) {
    navigator.geolocation.clearWatch(runWatchId);
    runWatchId = null;
  }
  if (runTimerInterval) {
    clearInterval(runTimerInterval);
    runTimerInterval = null;
  }

  runPath = [];
  runTotalDist = 0;
  runStartTime = null;
  runPauseTime = 0;
  runPauseStart = null;
  runIsPaused = false;
  runIsActive = true;

  // HUD + 컨트롤 표시
  document.getElementById('navRunHud').classList.add('active');
  document.querySelector('.nav').classList.add('running');
  document.getElementById('runControls').classList.add('active');

  // HUD 초기화
  document.getElementById('runDist').textContent = '0.00';
  document.getElementById('runTime').textContent = '00:00';
  document.getElementById('runPace').textContent = "--'--\"";
  document.getElementById('runMainBtnIcon').textContent = '⏸';
  document.getElementById('runPausedBanner').classList.remove('show');

  // WakeLock
  acquireWakeLock();

  // 잡아둔 위치로 메인 지도 이동 + 추적 시작
  if (runReadyLat && runReadyLng) {
    kakaoMap.setCenter(new kakao.maps.LatLng(runReadyLat, runReadyLng));
    kakaoMap.setLevel(3);
  }
  startGpsTracking();
}


async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      runWakeLock = await navigator.wakeLock.request('screen');
    }
  } catch(e) {}
}

function releaseWakeLock() {
  if (runWakeLock) {
    runWakeLock.release().catch(() => {});
    runWakeLock = null;
  }
}


function startGpsTracking() {
  if (runWatchId !== null) navigator.geolocation.clearWatch(runWatchId);

  runStartTime = Date.now();

  // 연결된 코스 경로 메인 지도에 표시 (점선 가이드)
  if (runLinkedCourse && runLinkedCourse.path && runLinkedCourse.path.length > 1) {
    const guidePath = runLinkedCourse.path.map(([lat, lng]) => new kakao.maps.LatLng(lat, lng));
    new kakao.maps.Polyline({
      map: kakaoMap,
      path: guidePath,
      strokeWeight: 5,
      strokeColor: 'rgba(200,255,0,0.4)',
      strokeOpacity: 1,
      strokeStyle: 'dashed'
    });
    showToast(`📍 ${runLinkedCourse.name} 경로를 따라 뛰어요!`);
  }

  // 타이머
  clearInterval(runTimerInterval);
  runTimerInterval = setInterval(updateRunHUD, 1000);

  // GPS 추적
  runWatchId = navigator.geolocation.watchPosition(
    pos => {
      if (!runIsActive || runIsPaused) return;
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      if (runPath.length > 0) {
        const last = runPath[runPath.length - 1];
        const d = calcDist(last[0], last[1], lat, lng);
        if (d < 0.005) return;
        runTotalDist += d;
      }

      runPath.push([lat, lng]);
      updateRunPolyline();
      updateRunLocMarker(lat, lng);
      kakaoMap.setCenter(new kakao.maps.LatLng(lat, lng));
    },
    err => { if (err.code === 1) showToast('위치 권한이 필요해요 🙏'); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  );
}

function updateRunPolyline() {
  if (runPath.length < 2) return;
  if (runPolyline) runPolyline.setMap(null);
  const linePath = runPath.map(([lat, lng]) => new kakao.maps.LatLng(lat, lng));
  runPolyline = new kakao.maps.Polyline({
    map: kakaoMap,
    path: linePath,
    strokeWeight: 6,
    strokeColor: '#c8ff00',
    strokeOpacity: 0.9,
    strokeStyle: 'solid'
  });
}

function updateRunLocMarker(lat, lng) {
  if (runLocOverlay) runLocOverlay.setMap(null);
  const runnerSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="52" viewBox="0 0 40 52"
      style="filter:drop-shadow(0 3px 8px rgba(0,0,0,0.6));display:block">
      <circle cx="20" cy="18" r="18" fill="#c8ff00"/>
      <circle cx="20" cy="18" r="18" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="1.5"/>
      <polygon points="20,36 14,48 26,48" fill="#c8ff00"/>
      <circle cx="23" cy="8" r="3.2" fill="#0d0d0d"/>
      <line x1="22" y1="12" x2="18" y2="20" stroke="#0d0d0d" stroke-width="2.3" stroke-linecap="round"/>
      <line x1="21" y1="14" x2="27" y2="11" stroke="#0d0d0d" stroke-width="1.9" stroke-linecap="round"/>
      <line x1="20" y1="15" x2="15" y2="18" stroke="#0d0d0d" stroke-width="1.9" stroke-linecap="round"/>
      <line x1="18" y1="20" x2="25" y2="27" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
      <line x1="18" y1="20" x2="13" y2="25" stroke="#0d0d0d" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  runLocOverlay = new kakao.maps.CustomOverlay({
    position: new kakao.maps.LatLng(lat, lng),
    content: `<div style="pointer-events:none">${runnerSvg}</div>`,
    zIndex: 20, yAnchor: 1.1, xAnchor: 0.5
  });
  runLocOverlay.setMap(kakaoMap);
}



function updateRunHUD() {
  if (!runIsActive || runIsPaused) return;

  const elapsed = getRunElapsedSec();

  // 시간 포맷
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const timeStr = h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;

  document.getElementById('runTime').textContent = timeStr;
  document.getElementById('runDist').textContent = runTotalDist.toFixed(2);

  // 페이스 (분/km)
  if (runTotalDist > 0.05 && elapsed > 5) {
    const paceSecPerKm = elapsed / runTotalDist;
    const pm = Math.floor(paceSecPerKm / 60);
    const ps = Math.round(paceSecPerKm % 60);
    document.getElementById('runPace').textContent = `${pm}'${String(ps).padStart(2,'0')}"`;

    // 실시간 칼로리: 거리 기반 + 속도 강도 보정 (체중 65kg)
    const speedKmh = runTotalDist / (elapsed / 3600);
    const baseKcal = 65 * runTotalDist * 1.036;
    const intensityBonus = Math.min(0.15, Math.max(0, (speedKmh - 6) / 10 * 0.15));
    const kcal = Math.round(baseKcal * (1 + intensityBonus));
    document.getElementById('runKcal').textContent = kcal;
  }
}

function getRunElapsedSec() {
  if (!runStartTime) return 0;
  const now = Date.now();
  const pausedMs = (runPauseTime || 0) + (runPauseStart ? now - runPauseStart : 0);
  return Math.floor((now - runStartTime - pausedMs) / 1000);
}

// ── 일시정지 / 재개 ──
function toggleRunPause() {
  if (!runIsActive) return;

  runIsPaused = !runIsPaused;

  if (runIsPaused) {
    runPauseStart = Date.now();
    document.getElementById('runMainBtnIcon').textContent = '▶';
    document.getElementById('runPausedBanner').classList.add('show');
  } else {
    if (runPauseStart) {
      runPauseTime = (runPauseTime || 0) + (Date.now() - runPauseStart);
      runPauseStart = null;
    }
    document.getElementById('runMainBtnIcon').textContent = '⏸';
    document.getElementById('runPausedBanner').classList.remove('show');
  }
}

// ── 종료 ──
function stopRunMode() {
  if (!runIsActive) return;

  // 최소 거리 체크
  if (runTotalDist < 0.1) {
    if (!confirm('아직 거리가 너무 짧아요 (100m 미만).\n그래도 종료할까요?')) return;
  }

  runIsActive = false;
  runIsPaused = false;
  clearInterval(runTimerInterval);
  runTimerInterval = null;

  if (runWatchId !== null) {
    navigator.geolocation.clearWatch(runWatchId);
    runWatchId = null;
  }

  runPath = [];
  runStartTime = null;
  runPauseTime = 0;
  runPauseStart = null;

  releaseWakeLock();

  // 완료 통계 계산
  const elapsed = getRunElapsedSec();
  const dist = runTotalDist;

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const timeStr = h > 0
    ? `${h}시간 ${m}분 ${s}초`
    : `${m}분 ${s}초`;

  let paceStr = '--';
  if (dist > 0.05 && elapsed > 5) {
    const pm = Math.floor(elapsed / dist / 60);
    const ps = Math.round((elapsed / dist) % 60);
    paceStr = `${pm}'${String(ps).padStart(2,'0')}"`;
  }

  const kcal = Math.round(dist * 70 * 1.05);

  // 완료 통계를 토스트로 표시하고 기록 자동 저장
  const minDur = Math.round(elapsed / 60);
  records.unshift({
    id: 'r' + Date.now(),
    courseId: runLinkedCourse ? runLinkedCourse.id : null,
    courseName: runLinkedCourse ? runLinkedCourse.name : '내 러닝 경로',
    date: new Date().toISOString().slice(0, 10),
    duration: minDur,
    difficulty: '적당해',
    satisfaction: 3,
    wantAgain: true,
    memo: `${dist.toFixed(2)}km · ${timeStr} · ${kcal}kcal`
  });
  saveState();
  checkBadges();

  // HUD + 컨트롤 닫기
  document.getElementById('navRunHud').classList.remove('active');
  document.querySelector('.nav').classList.remove('running');
  document.getElementById('runControls').classList.remove('active');
  document.getElementById('runPausedBanner').classList.remove('show');
  if (runPolyline) { runPolyline.setMap(null); runPolyline = null; }
  if (runLocOverlay) { runLocOverlay.setMap(null); runLocOverlay = null; }
  runLinkedCourse = null;

  showRunResult({ dist, timeStr, elapsed, kcal });
}


// ── 러닝 결과 화면 ──
const QUOTES = [
  "느려도 괜찮다 — 멈추지만 않으면 된다",
  "오늘의 1km가 내일의 10km를 만든다",
  "달리기는 몸이 아니라 마음이 먼저 포기한다",
  "땀은 거짓말하지 않는다",
  "지금 이 순간도 누군가는 달리고 있다",
  "어제보다 오늘, 오늘보다 내일",
];

function showRunResult({ dist, timeStr, elapsed, kcal }) {
  const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
  const today = new Date().toLocaleDateString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit' });

  // 치킨 환산
  const chickenHalf = 313;
  const chickenLabel = kcal >= chickenHalf ? `치킨 ${Math.floor(kcal/chickenHalf)}마리 반` : `치킨 반 마리 가까이`;

  // 한강 환산 (마포대교 왕복 약 5.4km)
  const hangang = 5.4;
  const hangangTimes = (dist / hangang).toFixed(1);
  const hangangLabel = dist >= hangang ? `한강 다리 ${hangangTimes}번 건넌 거리` : `한강 다리 ${Math.round(dist/hangang*100)}% 건넌 거리`;

  // 지방 환산 (지방 1g = 7.7kcal)
  const fat = Math.round(kcal / 7.7);

  // 페이스
  let paceStr = '--'--"';
  if (dist > 0.05 && elapsed > 5) {
    const pm = Math.floor(elapsed / dist / 60);
    const ps = Math.round((elapsed / dist) % 60);
    paceStr = `${pm}'${String(ps).padStart(2,'0')}"`;
  }

  // 뱃지
  const totalRuns = records.length;
  const totalDist = records.reduce((s, r) => s + (parseFloat(r.memo) || 0), 0);
  const badges = [];
  if (dist >= 5 && records.filter(r => parseFloat(r.memo) >= 5).length === 1) badges.push({ text: '🏅 5km 첫 돌파', isNew: true });
  if (dist >= 10 && records.filter(r => parseFloat(r.memo) >= 10).length === 1) badges.push({ text: '🏅 10km 첫 돌파', isNew: true });
  // 연속 뱃지
  const streak = getStreak();
  if (streak >= 3) badges.push({ text: `🔥 ${streak}일 연속`, isNew: streak === 3 });
  badges.push({ text: `총 ${totalRuns}회`, isNew: false });
  badges.push({ text: `누적 ${totalDist.toFixed(1)}km`, isNew: false });

  const badgeHTML = badges.map(b =>
    `<div class="result-badge${b.isNew ? ' new' : ''}">${b.text}</div>`
  ).join('');

  const html = `
<div class="run-result-overlay" id="runResultOverlay">
  <div class="run-result-sheet">
    <div class="rr-header">
      <div class="rr-date">${today}</div>
      <div class="rr-quote">"${quote}"</div>
      <div class="rr-sub">오늘도 해냈어요 🎉</div>
    </div>
    <div class="rr-stats">
      <div class="rr-stat"><div class="rr-val">${dist.toFixed(2)}</div><div class="rr-unit">km</div><div class="rr-lbl">거리</div></div>
      <div class="rr-stat"><div class="rr-val">${timeStr}</div><div class="rr-unit"></div><div class="rr-lbl">시간</div></div>
      <div class="rr-stat"><div class="rr-val">${paceStr}</div><div class="rr-unit">분/km</div><div class="rr-lbl">페이스</div></div>
      <div class="rr-stat"><div class="rr-val">${kcal}</div><div class="rr-unit">kcal</div><div class="rr-lbl">칼로리</div></div>
    </div>
    <div class="rr-divider"></div>
    <div class="rr-earned">
      <div class="rr-earn-card">
        <div class="rr-earn-icon">🍗</div>
        <div class="rr-earn-text">
          <strong>${chickenLabel} 태웠어요</strong>
          <span class="rr-num">${kcal}kcal</span> 소모 — 오늘 치킨 먹어도 돼요
        </div>
      </div>
      <div class="rr-earn-card">
        <div class="rr-earn-icon">🌉</div>
        <div class="rr-earn-text">
          <strong>${hangangLabel}</strong>
          <span class="rr-num">${dist.toFixed(2)}km</span> — 두 발로 완주했어요
        </div>
      </div>
      <div class="rr-earn-card">
        <div class="rr-earn-icon">🔥</div>
        <div class="rr-earn-text">
          <strong>지방 ${fat}g 녹였어요</strong>
          <span class="rr-num">${elapsed < 3600 ? Math.floor(elapsed/60)+'분' : timeStr}</span> 동안 몸이 확실히 바뀌고 있어요
        </div>
      </div>
    </div>
    <div class="rr-divider"></div>
    <div class="rr-badges">${badgeHTML}</div>
    <div class="rr-footer">
      <button class="rr-btn" onclick="closeRunResult()">닫기</button>
      <button class="rr-btn primary" onclick="closeRunResult()">저장 완료 ✓</button>
    </div>
  </div>
</div>`;

  document.body.insertAdjacentHTML('beforeend', html);
}

function getStreak() {
  if (!records.length) return 1;
  const dates = records.map(r => r.date).sort((a,b) => b.localeCompare(a));
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i-1]);
    const curr = new Date(dates[i]);
    const diff = (prev - curr) / 86400000;
    if (diff === 1) streak++;
    else break;
  }
  return streak;
}

function closeRunResult() {
  const el = document.getElementById('runResultOverlay');
  if (el) el.remove();
}

// ── 기록만 저장 ──
function saveRunAsRecord() {
  const elapsed = getRunElapsedSec();
  const dist = runTotalDist;
  const minDur = Math.round(elapsed / 60);

  records.unshift({
    id: 'r' + Date.now(),
    courseId: runLinkedCourse ? runLinkedCourse.id : null,
    courseName: runLinkedCourse ? runLinkedCourse.name : '내 러닝 경로',
    date: new Date().toISOString().slice(0, 10),
    duration: minDur,
    difficulty: '적당해',
    satisfaction: 3,
    wantAgain: true,
    memo: `${dist.toFixed(2)}km 직접 러닝`
  });
  saveState();
  checkBadges();
  runLinkedCourse = null;

  closeRunFinish();
  showToast('📋 기록이 저장됐어요!');
}

// ── 기록 + 코스 제보 ──
function saveRunAndReport() {
  closeRunFinish();

  // 제보 폼에 경로 자동 주입
  const path = runPath;
  const dist = runTotalDist;

  // 제보 모달 열기
  openReportModal();

  // 잠깐 기다렸다가 경로 주입 (지도 초기화 후)
  setTimeout(() => {
    injectRunPathToReport(path, dist);
  }, 600);
}

function injectRunPathToReport(path, dist) {
  if (!reportMap || path.length < 2) return;

  // 기존 내용 초기화
  reportMapReset();

  // 경로 점 주입
  path.forEach(([lat, lng]) => {
    reportWaypoints.push([lat, lng]);
    const idx = reportWaypoints.length;
    const dotContent = `<div style="
      width:18px;height:18px;border-radius:50%;
      background:${idx===1?'#c8ff00':'rgba(200,255,0,0.5)'};
      border:2px solid #0d0d0d;font-size:9px;font-weight:700;color:#0d0d0d;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 1px 4px rgba(0,0,0,0.4);
    ">${idx<=9?idx:'·'}</div>`;
    const dot = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(lat, lng),
      content: dotContent,
      yAnchor: 0.5, xAnchor: 0.5, zIndex: 5
    });
    dot.setMap(reportMap);
    reportDotOverlays.push(dot);
  });

  // 경로 직접 그리기 (OSRM 대신 실제 GPS 경로 사용)
  const linePath = path.map(([lat, lng]) => new kakao.maps.LatLng(lat, lng));
  reportOsrmPath = path;

  if (reportPolyline) reportPolyline.setMap(null);
  reportPolyline = new kakao.maps.Polyline({
    map: reportMap,
    path: linePath,
    strokeWeight: 4,
    strokeColor: '#c8ff00',
    strokeOpacity: 0.9,
    strokeStyle: 'solid'
  });

  // 거리 표시
  const km = dist.toFixed(1);
  document.getElementById('reportMapDist').textContent = km + ' km';
  document.getElementById('rKm').value = km;

  // 힌트 업데이트
  document.getElementById('reportMapHint').textContent = `GPS 경로 자동 입력됨 (${path.length}점)`;

  // 경로 전체 보이게
  const bounds = new kakao.maps.LatLngBounds();
  linePath.forEach(p => bounds.extend(p));
  reportMap.setBounds(bounds, 30);

  showToast('GPS 경로가 제보 폼에 자동 입력됐어요 📍');
}

// ── 완료 모달 닫기 ──
function closeRunFinish() {
  // 완주 모달 제거됨
  document.getElementById('navRunHud').classList.remove('active');
  document.querySelector('.nav').classList.remove('running');
  document.getElementById('runControls').classList.remove('active');
  document.getElementById('runPausedBanner').classList.remove('show');
  runLinkedCourse = null;

  // 지도 오버레이 정리
  if (runPolyline) { runPolyline.setMap(null); runPolyline = null; }
  if (runLocOverlay) { runLocOverlay.setMap(null); runLocOverlay = null; }
}

function discardRun() {
  if (confirm('이번 러닝 기록을 버릴까요?')) {
    closeRunFinish();
    showToast('러닝 기록이 삭제됐어요');
  }
}

function showToast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2800);
}
