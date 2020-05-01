const path = require('path');
const fs = require('fs');

const chrome = require('chrome-aws-lambda');
const p = require('phin');

const isDev = process.env.NOW_REGION === 'dev1';
let page;

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
      temps += `<text class="t" x="${pos.x}" y="${pos.y}">${temp_celcius}°</text>`;
    }
    if (wind_direction) {
      winds += `<use xlink:href="#w" class="w" x="${pos.x - 20}" y="${
        pos.y - 20
      }" transform="rotate(${wind_direction}, ${pos.x}, ${pos.y})"/>`;
    }
  });
  const obs = winds + temps;

  const { body: rainareaBody } = await rainareaFetch;
  const { id, radar, width, height } = rainareaBody;
  const datetime = timeID(id);

  return { obs, datetime, radar: radar.trimEnd(), width, height };
}

const localChrome = isDev ? require('chrome-finder')() : null;
async function getBrowserPage() {
  try {
    const browser = await chrome.puppeteer.launch({
      ignoreHTTPSErrors: true,
      defaultViewport: {
        width: 400,
        height: 226,
        deviceScaleFactor: 2,
        isLandscape: true,
      },
      ...(isDev
        ? {
            headless: false,
            executablePath: localChrome,
          }
        : {
            args: chrome.args,
            executablePath: await chrome.executablePath,
            headless: chrome.headless,
          }),
    });

    const p = await browser.newPage();
    return p;
  } catch (e) {
    console.error(e);
  }
}

function getMinutes(timestamp) {
  // Don't care about AM/PM at all
  const [hour, min] = timestamp.split(':');
  return hour * 60 + min;
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

const radarHTML = fs.readFileSync(path.join(__dirname, '../pages/radar.html'), {
  encoding: 'utf-8',
});

async function handler(req, res) {
  if (/favicon/i.test(req.url)) {
    res.status(204).send();
    return;
  }

  try {
    console.time('V2 Execution time');
    const dataPromise = getAllData();
    if (!page) page = await getBrowserPage();

    const data = await dataPromise;
    const html = template(radarHTML, data);
    await page.setContent(html);

    const imageBuffer = await page.screenshot({
      type: 'jpeg',
      quality: 80,
    });
    res.setHeader('Content-Type', 'image/jpeg');

    const localTime = new Date().toLocaleTimeString('en-US', {
      timeZone: 'Asia/Singapore',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const minutes = 5 - minusDts(localTime, data.datetime);
    if (minutes <= 0) {
      res.setHeader('Cache-Control', `s-maxage=30, stale-while-revalidate`);
    } else {
      res.setHeader('Cache-Control', `public, max-age=${minutes * 60}`);
    }

    res.end(imageBuffer);
    console.timeEnd('V2 Execution time');
  } catch (e) {
    console.error(e);
  }
}

module.exports = handler;

// if (isDev) {
//   const PORT = process.env.PORT || 13463;
//   const listen = () => console.log(`Listening on ${PORT}...`);
//   createServer(handler).listen(PORT, listen);
// }
