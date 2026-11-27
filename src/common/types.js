// @ts-check
/**
 * Shapes of the JSON files written by tools/*.py into data/grenoble/ (type definitions only).
 * Local frame in metres: x = east, y = north, origin = LineIndex.origin (shared by every file, ADR 0010).
 */

/**
 * @typedef {object} Stop
 * @property {string} name
 * @property {string} commune
 * @property {number} s distance along the route from the first stop (m)
 * @property {number} off lateral offset of the stop from the route (m)
 * @property {number} x
 * @property {number} y
 * @property {number} t scheduled time from the first stop (s)
 * @property {boolean} [served] set during a game once the stop has been served
 * @property {boolean} [missed] set during a game when the bus passed the stop without serving it
 */

/**
 * One trip pattern of a line: the trips of a direction that serve the same stops (ADR 0010).
 * @typedef {object} Route
 * @property {number} direction GTFS direction id
 * @property {string} headsign
 * @property {number} trips number of trips of the pattern in the GTFS
 * @property {number} length route length (m)
 * @property {number[]} pts flat [x, y, z, x, y, z, ...], one point every LineData.step metres
 * @property {Stop[]} stops
 * @property {Record<string, string[]>} services departure times ("HH:MM") by GTFS service id
 */

/**
 * @typedef {object} CalendarEntry
 * @property {string} days seven "0"/"1" flags, Monday first
 * @property {string} start YYYYMMDD
 * @property {string} end YYYYMMDD
 */

/** @typedef {Record<string, CalendarEntry>} Calendar */

/**
 * A line file, data/grenoble/lines/<id>.json.
 * @typedef {object} LineData
 * @property {string} id M réso line number, e.g. "17" or "N62"
 * @property {string} name
 * @property {string} color CSS colour of the line
 * @property {string} text_color CSS colour of the text on the line colour
 * @property {number} step
 * @property {Route[]} routes by direction, the main (longest) route of each direction first
 * @property {Calendar} calendar
 */

/**
 * @typedef {object} LineSummary
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {string} text_color
 * @property {string[]} termini first and last stop of the main route of the first direction
 */

/**
 * data/grenoble/lines/index.json.
 * @typedef {object} LineIndex
 * @property {number[]} origin [lat, lon] of the local frame
 * @property {number[]} bbox [x0, y0, x1, y1] of every route
 * @property {LineSummary[]} lines in menu order
 */

/**
 * @typedef {object} MapData
 * @property {string} attribution
 * @property {number[]} bbox
 * @property {Record<string, number[][]>} polys flat [x, y, x, y, ...] rings by class
 * @property {Record<string, number[][]>} lines flat [x, y, x, y, ...] polylines by class
 */

/**
 * @typedef {object} TerrainGrid
 * @property {number} x0
 * @property {number} y0
 * @property {number} nx
 * @property {number} ny
 * @property {number} step
 * @property {number[]} dm elevations in decimetres, row by row from south to north
 */

/**
 * @typedef {object} TerrainData
 * @property {TerrainGrid} fine
 * @property {TerrainGrid} coarse
 */

/**
 * @typedef {object} BuildingsData
 * @property {string} attribution
 * @property {number[][]} b [height_dm, kind, style, roof_rise_dm, x0, y0, x1, y1, ...] per building
 * @property {number[]} trees flat [x, y, ...]
 */

/**
 * Road graph written by tools/build_roads.py (ADR 0002); coordinates in decimetres.
 * @typedef {object} RoadsData
 * @property {string} attribution
 * @property {string[]} classes class index -> name
 * @property {string[]} flags bit i of an edge flag mask -> name
 * @property {number[]} nodes flat [x, y, ...] per graph node
 * @property {number[][]} edges [a, b, class, width_dm, layer, flag_mask, x, y, x, y, ...]
 * @property {number[][]} [signals] junctions with traffic lights: node indices of each group sharing one cycle
 */

/**
 * @typedef {object} DriveInput
 * @property {boolean} up
 * @property {boolean} down
 * @property {boolean} left
 * @property {boolean} right
 */

export {};
