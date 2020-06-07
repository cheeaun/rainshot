const path = require('path');
const fs = require('fs');

const p = require('phin');
const { contours } = require('d3-contour');
const { geoPath } = require('d3-geo');
const sharp = require('sharp');
const TextToSVG = require('text-to-svg');
const textToSVG = TextToSVG.loadSync(
  path.join(__dirname, '../fonts/OpenSans-Bold.ttf'),
);

const lowerLat = 1.156,
  upperLat = 1.475,
  lowerLong = 103.565,
  upperLong = 104.13;
const longRange = upperLong - lowerLong;
const latRange = upperLat - lowerLat;

function calcPos(long, lat) {
  return {
    x: ((long - lowerLong) / longRange) * 400,
    y: ((upperLat - lat) / latRange) * 226,
  };
}

function template(string, data, prop) {
  for (prop in data) {
    string = string.replace(new RegExp('{{' + prop + '}}', 'g'), data[prop]);
  }
  return string;
}

const timeID = (id) =>
  (id.match(/\d{4}$/) || [''])[0].replace(/(\d{2})(\d{2})/, (m, m1, m2) => {
    let h = parseInt(m1, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (h == 0) h = 12;
    if (h > 12) h -= 12;
    return h + ':' + m2 + ' ' + ampm;
  });

function convertRadar2Values(radar, width, height) {
  const rows = radar.trimEnd().split(/\n/g);
  const values = new Array(width * height).fill(0);
  for (let y = 0, l = rows.length; y < l; y++) {
    const chars = rows[y];
    for (let x = chars.search(/[^\s]/), rl = chars.length; x < rl; x++) {
      const char = chars[x];
      if (char && char !== ' ') {
        const intensity = char.charCodeAt() - 33;
        values[y * width + x] = intensity;
      }
    }
  }
  return values;
}

const intensityColors = [
  '#40FFFD',
  '#3BEEEC',
  '#32D0D2',
  '#2CB9BD',
  '#229698',
  '#1C827D',
  '#1B8742',
  '#229F44',
  '#27B240',
  '#2CC53B',
  '#30D43E',
  '#38EF46',
  '#3BFB49',
  '#59FA61',
  '#FEFB63',
  '#FDFA53',
  '#FDEB50',
  '#FDD74A',
  '#FCC344',
  '#FAB03F',
  '#FAA23D',
  '#FB8938',
  '#FB7133',
  '#F94C2D',
  '#F9282A',
  '#DD1423',
  '#BE0F1D',
  '#B21867',
  '#D028A6',
  '#F93DF5',
];

const contour = contours()
  .thresholds([4, 10, 20, 30, 40, 50, 60, 70, 80, 85, 90, 95, 97.5])
  .smooth(false);
const svgPath = geoPath();
function convertRadar2SVG(radar, width, height) {
  const values = convertRadar2Values(radar, width, height);
  const conValues = contour.size([width, height])(values);
  let svg = '';
  for (let i = 0, l = conValues.length; i < l; i++) {
    const con = conValues[i];
    const d = svgPath(con);
    const intensity = con.value;
    if (intensity && d) {
      const fill =
        intensityColors[Math.round((con.value / 100) * intensityColors.length)];
      const opacity = intensity > 90 ? 1 : 0.4;
      svg += `<path d="${d}" fill="${fill}" fill-opacity="${opacity}" />`;
    }
  }
  return svg;
}

async function getAllData() {
  const obsFetch = p({
    url: 'https://api.checkweather.sg/v2/observations',
    parse: 'json',
  });
  const rainareaFetch = p({
    url: 'https://api.checkweather.sg/v2/rainarea',
    parse: 'json',
  });

  const { body: obsBody } = await obsFetch;
  let temps = '',
    winds = '';
  obsBody.forEach((f) => {
    const { lng, lat, temp_celcius, wind_direction } = f;
    const pos = calcPos(lng, lat);
    if (temp_celcius) {
      const tempD = textToSVG.getD(temp_celcius + '°', {
        x: pos.x,
        y: pos.y,
        fontSize: 13,
        anchor: 'center middle',
      });
      temps += `
        <path d="${tempD}" stroke="black" stroke-width="3"/>
        <path d="${tempD}" fill="rgba(255, 255, 0, .8)"/>
      `;
    }
    if (wind_direction) {
      winds += `<use xlink:href="#w" class="w" x="${pos.x - 20}" y="${
        pos.y - 20
      }" transform="rotate(${wind_direction}, ${pos.x}, ${
        pos.y
      })" opacity="0.5"/>`;
    }
  });
  const obs = winds + temps;

  const { body: rainareaBody } = await rainareaFetch;
  const { id, radar, width, height } = rainareaBody;
  const datetime = timeID(id);
  const datetimePath = textToSVG.getPath(datetime, {
    x: 384,
    y: 210,
    fontSize: 16,
    anchor: 'right baseline',
    attributes: {
      fill: 'white',
      stroke: 'rgba(255, 255, 255, .25)',
      'stroke-width': 3,
    },
  });

  const radarSVG = convertRadar2SVG(radar, width, height);

  return {
    obs,
    datetime,
    datetimePath,
    id,
    radar: radar.trimEnd(),
    width,
    height,
    radarSVG,
  };
}

function minusDts(time1, time2) {
  try {
    const date1 = new Date(`01/01/01 ${time1}`);
    const date2 = new Date(`01/01/01 ${time2}`);
    return (date1 - date2) / 1000 / 60;
  } catch (e) {
    return 0;
  }
}

const radarSVG = fs.readFileSync(path.join(__dirname, '../pages/radar.svg'), {
  encoding: 'utf-8',
});

async function handler(req, res) {
  if (/favicon/i.test(req.url)) {
    res.status(204).send();
    return;
  }

  const queryDt = req.query.dt;

  try {
    console.time('V3 Execution time');
    const data = await getAllData();
    const svg = template(radarSVG, data);

    const density = 144; // default 72 (1X)
    const imageBuffer = await sharp(Buffer.from(svg), { density })
      .jpeg({
        quality: 80,
        progressive: true,
      })
      .toBuffer();
    res.setHeader('Content-Type', 'image/jpeg');

    if (data.id === queryDt) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      const localTime = new Date().toLocaleTimeString('en-US', {
        timeZone: 'Asia/Singapore',
        hour: '2-digit',
        minute: '2-digit',
      });
      const minutes = 6 - minusDts(localTime, data.datetime);
      if (minutes <= 0 || minutes > 6) {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      } else {
        res.setHeader('Cache-Control', `public, max-age=${minutes * 60}`);
      }
    }

    res.end(imageBuffer);
    console.timeEnd('V3 Execution time');
  } catch (e) {
    console.error(e);
  }
}

module.exports = handler;
