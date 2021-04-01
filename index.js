// Config variables
const speed = 1;
const interval = 1 / speed;

var currentRowIdx;
var currentRow;
var map;
var directionsService;
var activeRoutes = [];
var decayRoutes = [];
var simulationTime;

var updateSimulationTimeInterval;
var updateActiveRoutesInterval;
var updatePositionsInterval;
var cleanUpRoutesInterval;
var decayCompletedRoutesInterval;

function clamp(num, min, max) {
  return num <= min ? min : num >= max ? max : num;
}

function formatResult(result) {
  return {
    tripId: result['tripId'],
    startTime: Date.parse(result['startTime']),
    endTime: Date.parse(result['endTime']),
    tripDistance: parseFloat(result['tripDistance']),
    tripDuration: parseFloat(result['tripDuration']),
    startCentroidLatitude: parseFloat(result['startCentroidLatitude']),
    startCentroidLongitude: parseFloat(result['startCentroidLongitude']),
    endCentroidLatitude: parseFloat(result['endCentroidLatitude']),
    endCentroidLongitude: parseFloat(result['endCentroidLongitude']),
    points: google.maps.geometry.encoding.decodePath(result['encodedPoints'])
  }
}

function fetchLineBuilder(prefetchNum) {
  /**
   * This function is a closure that prefetches the next `prefetchNum` scooter results
   * This is needed to limit the number of API calls we perform
   */

  var currStart;
  var currEnd;
  var totalCount;
  var results = [];

  async function fetchLine(idx) {
    if (!_.isNil(totalCount) && idx >= totalCount) {
      return {};
    }

    if (_.isNil(currStart) || _.isNil(currEnd) || idx < currStart || idx >= currEnd) {
      // If idx is outside of the current prefetched results, then we need to call the API
      currStart = idx;
      currEnd = currStart + prefetchNum;

      const res = await fetch(`http://localhost:3000/routes?start${currStart}&end=${currEnd}`);
      const resultsJson = await res.json();

      results = _.get(resultsJson, 'data');
      totalCount = parseInt(_.get(resultsJson, 'total'));
    }
    return formatResult(results[idx - currStart]);
  }
  return fetchLine;
}
const fetchLine = fetchLineBuilder(200);

function createRoute(points, duration) {
  // Create the visuals for this polyline
  const symbol = {
    path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
    scale: 2,
    strokeColor: "#339933FF",
  };

  const line = new google.maps.Polyline({
    path: points,
    icons: [
      {
        icon: symbol,
        offset: "0%"
      }
    ],
    geodesic: true,
    strokeColor: '#00000000',
    strokeOpacity: 1.0,
    strokeWeight: 3
  });

  line.setMap(map);
  activeRoutes.push({
    line: line,
    duration: duration,
    startTime: simulationTime
  });
}

function calculateT(route) {
  const startTime = _.get(route, 'startTime');
  const duration = _.get(route, 'duration');

  const t = (simulationTime - startTime) / duration;
  return t;
}

function hexToRgba(hex) {
  return {
    r: parseInt(hex.substring(1, 3), 16),
    g: parseInt(hex.substring(3, 5), 16),
    b: parseInt(hex.substring(5, 7), 16),
    a: parseInt(hex.substring(7, 11), 16)
  };
}

function rgbaToHex(rgba) {
  const r = _.get(rgba, 'r').toString(16);
  const g = _.get(rgba, 'g').toString(16);
  const b = _.get(rgba, 'b').toString(16);
  const a = _.get(rgba, 'a').toString(16);
  return `#${r}${g}${b}${a}`;
}

function updateSimulationTime() {
  simulationTime += speed;
}

async function updateActiveRoutes() {
  // Only add max 1 route per interval
  if (activeRoutes.length < 50 && !_.isNil(currentRow) && _.get(currentRow, 'startTime') < simulationTime) {
    const points = _.get(currentRow, 'points');
    const duration = _.get(currentRow, 'tripDuration');

    createRoute(points, duration);

    currentRowIdx++;
    currentRow = await fetchLine(currentRowIdx);
  }
}

function updatePositions() {
  _.forEach(activeRoutes, route => {
    const icons = _.get(route, 'line.icons');

    offset = String(icons[0].offset)
    prevOffset = parseFloat(offset.substring(0, offset.indexOf('%')));

    const t = clamp(calculateT(route) * 100, 0, prevOffset + 0.09);
    const perc = t + '%';

    icons[0].offset = perc;
    route.line.set('icons', icons);
  })
}

function decayCompletedRoutes() {
  _.forEach(decayRoutes, route => {
    const icons = _.get(route, 'line.icons');
    const color = _.get(icons, '[0].icon.strokeColor');
    const rgba = hexToRgba(color);
    rgba['a'] = rgba['a'] - interval;
    const hex = rgbaToHex(rgba);
    _.set(icons, '[0].icon.strokeColor', hex)
    route.line.set('icons', icons);
  })
}

function cleanUpRoutes() {
  // Start decaying any completed routes
  const removed = _.remove(activeRoutes, route => {
    const t = calculateT(route);
    return t >= 1;
  });

  decayRoutes = _.concat(decayRoutes, removed);

  // Remove any completely decayed routes
  fullyDecayedRoutes = _.remove(decayRoutes, route => {
    const icons = _.get(route, 'line.icons');
    const color = _.get(icons, '[0].icon.strokeColor');
    const rgba = hexToRgba(color);
    return rgba['a'] <= 0;
  });

  _.forEach(fullyDecayedRoutes, route => {
    route.line.setMap(null);
  });
}

async function initMap() {
  // Initialize the google maps components
  map = new google.maps.Map(document.getElementById('map'), {
    zoom: 12,
    center: { lat: 41.9012067343156, lng: -87.6763571260391 },
    streetViewControl: false,
  });

  directionsService = new google.maps.DirectionsService();

  // Fetch the first row
  currentRowIdx = 0
  currentRow = await fetchLine(currentRowIdx);

  // Start the simulation
  simulationTime = Date.now();
}

function start() {
  // Start the timers
  updateSimulationTimeInterval = setInterval(updateSimulationTime, interval);
  updateActiveRoutesInterval = setInterval(updateActiveRoutes, interval);
  updatePositionsInterval = setInterval(updatePositions, interval);
  cleanUpRoutesInterval = setInterval(cleanUpRoutes, interval);
  decayCompletedRoutesInterval = setInterval(decayCompletedRoutes, interval);
}

function stop() {
  clearInterval(updateSimulationTimeInterval)
  clearInterval(updateActiveRoutesInterval)
  clearInterval(updatePositionsInterval)
  clearInterval(cleanUpRoutesInterval)
  clearInterval(decayCompletedRoutesInterval)
}