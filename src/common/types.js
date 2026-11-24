// @ts-check
/**
 * Shapes of the JSON files written by tools/*.py into data/grenoble/ (type definitions only).
 * Local frame in metres: x = east, y = north, origin = LineData.origin.
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
 * @typedef {object} Direction
 * @property {number} id
 * @property {string} headsign
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
 * @typedef {object} HorizonView
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number[]} near
 */

/**
 * @typedef {object} Horizon
 * @property {number} step
 * @property {number[]} far
 * @property {number} z
 * @property {HorizonView[]} views
 */

/**
 * @typedef {object} LineData
 * @property {number[]} origin [lat, lon]
 * @property {string} color
 * @property {number} step
 * @property {string} name
 * @property {Direction[]} directions
 * @property {Calendar} calendar
 * @property {number[]} bbox [x0, y0, x1, y1]
 * @property {Horizon} horizon
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
 * @property {number[][]} b [height_dm, kind, x0, y0, x1, y1, ...] per building
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
 */

/**
 * @typedef {object} DriveInput
 * @property {boolean} up
 * @property {boolean} down
 * @property {boolean} left
 * @property {boolean} right
 */

export {};
