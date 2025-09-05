/* Advanced weather script
   - Chart.js for hourly chart
   - Leaflet map
   - Favorites (localStorage)
   - Background theme switching
   - AQI attempt via Open-Meteo (air_quality) when available
*/

const $ = s => document.querySelector(s);
const qs = s => document.querySelectorAll(s);
const fmt = v => new Intl.NumberFormat(undefined,{maximumFractionDigits:0}).format(v);

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&format=json&name=';
function forecastUrl(lat,lon, tz='auto'){
  // request current + hourly (for 48h) + daily + air_quality if supported
  const base = 'https://api.open-meteo.com/v1/forecast';
  const params = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: tz,
    current_weather: 'true',
    hourly: 'temperature_2m,apparent_temperature,relativehumidity_2m,weathercode,windspeed_10m',
    daily: 'weathercode,temperature_2m_max,temperature_2m_min',
    // include air quality fields (Open-Meteo supports some names; might not be available everywhere)
    // air_quality parameter is a separate extension; some endpoints include components like pm2_5
    // We'll attempt to request 'air_quality' fields in hourly query — if failure, ignore gracefully.
    // Note: Open-Meteo's exact param names can vary by region; this is best-effort.
    // Keep quiet about missing fields.
    // No API key required.
  });
  return `${base}?${params.toString()}`;
}

let units = 'metric'; // metric or imperial
let lastPlace = null;
let chart = null;
let mapInstance = null;
let marker = null;

/* Clock */
function tick(){
  $('#clock').textContent = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}
setInterval(tick, 1000); tick();

/* Theme switch based on weather code */
function setThemeByCode(code){
  const app = document.getElementById('app');
  app.classList.remove('theme-sunny','theme-rain','theme-snow','theme-default');
  if([0,1,2].includes(code)) app.classList.add('theme-sunny');
  else if([51,53,55,61,63,65,80,81,82].includes(code)) app.classList.add('theme-rain');
  else if([71,73,75,85,86].includes(code)) app.classList.add('theme-snow');
  else app.classList.add('theme-default');
}

/* Icon mapping (Weather Icons CSS classes) */
function wiFor(code){
  // Simplified mapping
  if(code===0) return 'wi-day-sunny';
  if(code===1) return 'wi-day-sunny-overcast';
  if(code===2) return 'wi-day-cloudy';
  if(code===3) return 'wi-cloud';
  if([45,48].includes(code)) return 'wi-fog';
  if([51,53,55,61,63,65,80,81,82].includes(code)) return 'wi-rain';
  if([71,73,75,85,86].includes(code)) return 'wi-snow';
  if([95,96,99].includes(code)) return 'wi-thunderstorm';
  return 'wi-na';
}

/* Small description */
function descFor(code){
  const map = {
    0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',
    45:'Fog',48:'Rime fog',51:'Light drizzle',53:'Drizzle',55:'Dense drizzle',
    61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',
    80:'Rain showers',81:'Showers',82:'Heavy showers',95:'Thunderstorm'
  };
  return map[code] || '—';
}

/* Chart setup */
function initChart(){
  const ctx = document.getElementById('hourChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Temp', data: [], tension: 0.35, fill:true, pointRadius:0 }] },
    options: {
      responsive: true,
      scales: {
        x: { display: false },
        y: { ticks: { callback: v => `${Math.round(v)}°` } }
      },
      plugins: { legend:{display:false}, tooltip:{mode:'index', intersect:false} }
    }
  });
}

/* Map init */
function initMap(lat=0, lon=0){
  if(!mapInstance){
    mapInstance = L.map('map', {zoomControl:false, attributionControl:false}).setView([lat,lon], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(mapInstance);
  }
  if(marker) marker.remove();
  marker = L.marker([lat,lon]).addTo(mapInstance);
  mapInstance.setView([lat,lon], 8);
}

/* Render functions */
function renderCurrent(data, placeLabel){
  // data.current_weather exists, plus hourly/daily arrays
  const timezone = data.timezone || 'auto';
  $('#tz').textContent = timezone;
  // current_weather or derived
  let cur = data.current_weather || {temperature: data.hourly?.temperature_2m?.[0] ?? 0, windspeed:0};
  // For compatibility: some Open-Meteo responses use current_weather.temperature + weathercode
  const code = cur.weathercode ?? (data.hourly?.weathercode?.[0] ?? 0);
  const temp = cur.temperature ?? data.hourly?.temperature_2m?.[0] ?? 0;
  const feels = (data.hourly?.apparent_temperature?.[0] ?? temp);
  const hum = data.hourly?.relativehumidity_2m?.[0] ?? (data.current_weather?.relativehumidity ?? '—');
  const wind = cur.windspeed ?? data.hourly?.windspeed_10m?.[0] ?? 0;

  setThemeByCode(code);
  $('#place').textContent = placeLabel || `${data.latitude?.toFixed(2)}, ${data.longitude?.toFixed(2)}`;
  $('#updated').textContent = `Updated ${new Date().toLocaleString()}`;
  $('#temp').textContent = units==='metric' ? `${fmt(temp)}°C` : `${fmt(temp*9/5+32)}°F`;
  $('#feels').textContent = units==='metric' ? `${fmt(feels)}°C` : `${fmt(feels*9/5+32)}°F`;
  $('#hum').textContent = hum ? `${fmt(hum)}%` : '—';
  $('#wind').textContent = units==='metric' ? `${fmt(wind)} km/h` : `${fmt(wind/1.609)} mph`;
  $('#bigIcon').className = 'big-icon wi ' + wiFor(code);
  $('#bigIcon').setAttribute('title', descFor(code));
}

/* Hourly chart & forecast */
function renderHourlyAndDaily(data){
  const hours = data.hourly?.time ?? [];
  const temps = data.hourly?.temperature_2m ?? [];
  // Use next 24 points (or fewer)
  const labels = hours.slice(0,24).map(t=> new Date(t).getHours()+':00');
  const values = temps.slice(0,24);
  if(chart) {
    chart.data.labels = labels;
    chart.data.datasets[0].data = values;
    chart.update();
  }
  // Daily
  const daily = data.daily || {};
  const time = daily.time || [];
  const tmax = daily.temperature_2m_max || [];
  const tmin = daily.temperature_2m_min || [];
  const wcode = daily.weathercode || [];
  $('#forecast').innerHTML = time.map((d,i)=>`
    <div class="day">
      <div class="d">${new Date(d).toLocaleDateString(undefined,{weekday:'short'})}</div>
      <div class="ic wi ${wiFor(wcode[i])}" style="font-size:26px"></div>
      <div class="t">${fmt(tmin[i] ?? 0)}° / ${fmt(tmax[i] ?? 0)}°</div>
    </div>
  `).join('');
}

/* Attempt to read AQI values (Open-Meteo has air quality arrays sometimes) */
function renderAirQuality(data){
  // Open-Meteo may include hourly PM2_5 or pm10 in hourly; check
  const hourly = data.hourly || {};
  const pm25 = hourly.pm2_5 || hourly['pm2_5'] || null;
  const pm10 = hourly.pm10 || hourly['pm10'] || null;
  if(pm25 && pm25.length){
    // show latest
    const latest = pm25[0] ?? pm25[pm25.length-1];
    $('#aqi').textContent = `PM2.5: ${fmt(latest)} µg/m³`;
  } else if(pm10 && pm10.length){
    $('#aqi').textContent = `PM10: ${fmt(pm10[0] || pm10[pm10.length-1])} µg/m³`;
  } else {
    $('#aqi').textContent = 'N/A';
  }
  $('#uv').textContent = (data.current_weather?.uv_index ?? data.hourly?.uv_index?.[0] ?? 'N/A');
}

/* Fetch and render whole payload */
async function loadAndRender(lat, lon, label){
  try{
    setStatus('Loading weather...');
    const url = forecastUrl(lat,lon);
    const res = await fetch(url);
    if(!res.ok) throw new Error('Weather fetch failed');
    const data = await res.json();
    lastPlace = {lat, lon, label};
    renderCurrent(data, label);
    renderHourlyAndDaily(data);
    renderAirQuality(data);
    initMap(lat,lon);
    saveLastSeen(lat,lon,label, data);
    setStatus('Updated successfully.');
  } catch(e){
    console.error(e); setStatus('Failed to load weather.');
  }
}

/* Geocoding helper */
async function geocode(name){
  const r = await fetch(GEO_URL + encodeURIComponent(name));
  if(!r.ok) return null;
  const d = await r.json();
  return (d.results && d.results.length) ? d.results[0] : null;
}

/* Favorites (localStorage) */
function loadFavorites(){
  const raw = localStorage.getItem('wt_favs');
  return raw ? JSON.parse(raw) : [];
}
function saveFavorites(list){
  localStorage.setItem('wt_favs', JSON.stringify(list));
  renderFavList();
}
function addFavorite(label, lat, lon){
  const list = loadFavorites();
  list.unshift({label, lat, lon});
  // unique by coords
  const uniq = Array.from(new Map(list.map(i=>[`${i.lat}_${i.lon}`, i])).values());
  saveFavorites(uniq.slice(0,12));
}
function renderFavList(){
  const list = loadFavorites();
  const el = $('#favList');
  el.innerHTML = list.map((f,i)=>`<button data-idx="${i}">${f.label || `${f.lat.toFixed(2)},${f.lon.toFixed(2)}`}</button>`).join('');
  el.querySelectorAll('button').forEach(b=>{
    b.onclick = e=>{
      const i = +b.dataset.idx;
      const f = list[i];
      loadAndRender(f.lat, f.lon, f.label);
    };
    b.ondblclick = e=>{
      // remove on double click
      const i = +b.dataset.idx;
      list.splice(i,1); saveFavorites(list);
    };
  });
}

/* UI helpers */
function setStatus(msg){ $('#status').textContent = msg; }
function saveLastSeen(lat,lon,label,data){
  localStorage.setItem('wt_last', JSON.stringify({lat,lon,label,t:Date.now()}));
}

/* Wiring */
document.addEventListener('DOMContentLoaded', async ()=>{
  initChart();
  renderFavList();

  $('#searchBtn').onclick = async ()=>{
    const q = $('#q').value.trim(); if(!q) return;
    setStatus('Searching...');
    try{
      const place = await geocode(q);
      if(!place){ setStatus('Location not found'); return; }
      const label = `${place.name}${place.admin1? ', '+place.admin1: ''}, ${place.country_code || ''}`;
      await loadAndRender(place.latitude, place.longitude, label);
    }catch(e){ setStatus('Search error'); }
  };

  $('#locBtn').onclick = ()=>{
    if(!navigator.geolocation){ setStatus('Geolocation not supported'); return; }
    setStatus('Getting location...');
    navigator.geolocation.getCurrentPosition(async pos=>{
      await loadAndRender(pos.coords.latitude, pos.coords.longitude, 'My location');
    }, err => setStatus('Location denied or failed'), {enableHighAccuracy:true, timeout:10000});
  };

  $('#unitBtn').onclick = ()=>{
    units = units === 'metric' ? 'imperial' : 'metric';
    $('#unitBtn').textContent = units==='metric' ? '°C' : '°F';
    if(lastPlace) loadAndRender(lastPlace.lat, lastPlace.lon, lastPlace.label);
  };

  $('#saveFav').onclick = ()=>{
    const label = $('#favName').value.trim() || $('#place').textContent;
    if(!lastPlace){ setStatus('No place to save'); return; }
    addFavorite(label, lastPlace.lat, lastPlace.lon);
    $('#favName').value = '';
    setStatus('Saved to favorites');
  };

  // Load last or default
  const last = JSON.parse(localStorage.getItem('wt_last') || 'null');
  if(last){
    loadAndRender(last.lat, last.lon, last.label);
  } else {
    // default Mumbai
    await loadAndRender(19.0760,72.8777,'Mumbai');
  }
});

/* init map global so we can call early */
function initMap(lat,lon){
  // create map if not created
  if(!mapInstance){
    mapInstance = L.map('map', {zoomControl:true}).setView([lat,lon], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(mapInstance);
  }
  if(marker) marker.remove();
  marker = L.marker([lat,lon]).addTo(mapInstance);
  mapInstance.setView([lat,lon], 8);
}
