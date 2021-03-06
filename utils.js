'use strict'

const scraperjs = require('scraperjs')
const assert = require('assert')
const consts = require('./consts')
const periods = consts.periods
const URL_ASISTENCIA_SALA = consts.URL_ASISTENCIA_SALA
const URL_ASISTENCIA_SALA_DETALLE = consts.URL_ASISTENCIA_SALA_DETALLE
const URL_ASISTENCIA_COMISIONES = consts.URL_ASISTENCIA_COMISIONES

// Convert a period into a period id for web scrapping
// (date|num) -> obj
function getPeriodoSala (periodo) {
  assert.ok(typeof periodo === 'number' || periodo instanceof Date, '[senadores-asistencia]: El periodo ingresado debe ser un número o una fecha.')

  let _period = {}
  if (typeof periodo === 'number') {
    _period = periods.filter(period => period.legislatura === periodo)
    // search directly by period id
    if (_period.length > 0) return _period[0]
    // search only by year
    _period = periods.filter(period => {
      return period.desde.getFullYear() <= periodo && periodo <= period.hasta.getFullYear()
    })[0]
    assert.ok(_period, '[senadores-asistencia]: Periodo de busqueda no encontrado')
    console.warn('[senadores-asistencia]: Solo se puede consultar por periodo legislativo. Si para un mismo año existe más de un periodo legislativo, solo se obtendran los resultados del primer periodo encontrado, por lo que jamas se obtendran los periodos posteriores en caso de existir. Prefiera busquedas por fecha o id de legislatura.')
    return _period
  }
  if (periodo instanceof Date) {
    // search by date
    _period = periods.filter(period => {
      return period.desde.getTime() <= periodo.getTime() && periodo.getTime() <= period.hasta.getTime()
    })[0]
    assert.ok(_period, '[senadores-asistencia]: Periodo de busqueda no encontrado')
    return _period
  }
}

// Convert a chilean month string into a month number to be used in Date constructor
// (str) -> num
function clMonthToMonth (clMonth) {
  assert.equal(typeof clMonth, 'string', `[senadores-asistencia]: No se puede convertir el mes ${clMonth}`)
  const months = {
    Enero: 0,
    Febrero: 1,
    Marzo: 2,
    Abril: 3,
    Mayo: 4,
    Junio: 5,
    Julio: 6,
    Agosto: 7,
    Septiembre: 8,
    Octubre: 9,
    Noviembre: 10,
    Diciembre: 11
  }
  assert.ok(months[clMonth] >= 0 && months[clMonth] < 12, `[senadores-asistencia]: No se puede convertir el mes ${clMonth}`)
  return months[clMonth]
}

// Get detailed attendance info
// (obj, obj, obj) => obj
function getDetalleAsistenciaSala (asistenciaGeneral, senador, periodo) {
  assert.equal(typeof asistenciaGeneral, 'object', '[senadores-asistencia]: La asistencia general ingresada debe ser un objeto.')
  assert.equal(typeof senador, 'object', '[senadores-asistencia]: El senador general ingresada debe ser un objeto.')
  assert.equal(typeof periodo, 'object', '[senadores-asistencia]: El periodo general ingresada debe ser un objeto.')

  let url = URL_ASISTENCIA_SALA_DETALLE.replace(/:periodo:/, periodo.legislatura)
  url = url.replace(/:senador-id:/, senador.id)

  return scraperjs.StaticScraper.create()
    .get(url)
    .scrape($ => {
      const detalle = $('table:last-child tr:not(:first-child)').map(function () {
        const str = $(this).find('td:last-child a').text()
        // console.log(str, periodo)
        const data = str.match(/(-{0,1}\d*) ([\s\S]*), [\s\S]* (\d*) de (\w*) de (\d*)/)
        const sesion = data[1]
        const tipo = data[2]
                      // año, mes, día
        const fecha = new Date(parseInt(data[5]), clMonthToMonth(data[4]), parseInt(data[3]))
        const asiste = $(this).find('td:first-child').has('img').length > 0
        return {
          sesion,
          tipo,
          fecha,
          asiste
        }
      }).get()
      return Object.assign(asistenciaGeneral, { detalle })
    })
}

// Get attendance for a single senator to regular room sessions
// (obj, obj, bool) -> obj
function getAsistenciaSala (senador, periodo, incluyeSenador) {
  assert.equal(typeof senador, 'object', '[senadores-asistencia]: El senador general ingresada debe ser un objeto.')
  assert.equal(typeof periodo, 'object', '[senadores-asistencia]: El periodo general ingresada debe ser un objeto.')
  assert.ok(typeof incluyeSenador === 'boolean' || typeof incluyeSenador === 'undefined', '[senadores-asistencia]: La opción \'incluye senador\' debe ser de tipo booleana.')

  const url = URL_ASISTENCIA_SALA.replace(/:periodo:/, periodo.legislatura)
  // Get general data of attendance
  return scraperjs.StaticScraper.create()
    .get(url)
    .scrape($ => {
      let total = $('#main h2').text().match(/(\d*)/g)
      total = parseInt(total[total.length - 2])
      const trSenador = $('#main table tr[align="left"]:not(:first-child) td:first-child')
                          .filter(function () {
                            return $(this).text() === senador.nombre
                          }).parent()
      const asistencia = parseInt(trSenador.find('td a:not([id])').text().trim())
      const inasistenciasJustificadas = isNaN(parseInt(trSenador.find('td a[id]').text().trim()))
                                        ? 0
                                        : parseInt(trSenador.find('td a[id]').text().trim())
      if (incluyeSenador) {
        return {
          senador,
          periodo,
          asistencia,
          inasistencias: {
            total: total - asistencia,
            justificadas: inasistenciasJustificadas,
            injustificadas: ((total - asistencia) - inasistenciasJustificadas) > 0
                            ? (total - asistencia) - inasistenciasJustificadas
                            : 0
          }
        }
      }
      return {
        periodo,
        asistencia,
        inasistencias: {
          total: total - asistencia,
          justificadas: inasistenciasJustificadas,
          injustificadas: ((total - asistencia) - inasistenciasJustificadas) > 0
                          ? (total - asistencia) - inasistenciasJustificadas
                          : 0
        }
      }
    }).then(result => {
      return getDetalleAsistenciaSala(result, senador, periodo)
    })
}

// Get attendance for a single senator to all of his commissions
// (obj, num, bool) -> arr
function getAsistenciaComisiones (senador, periodo, incluyeSenador) {
  assert.equal(typeof senador, 'object', '[senadores-asistencia]: El senador general ingresada debe ser un objeto.')
  assert.equal(typeof periodo, 'number', '[senadores-asistencia]: El periodo general ingresada debe ser un número.')
  assert.ok(typeof incluyeSenador === 'boolean' || typeof incluyeSenador === 'undefined', '[senadores-asistencia]: La opción \'incluye senador\' debe ser de tipo booleana.')

  let url = URL_ASISTENCIA_COMISIONES.replace(/:periodo:/, periodo)
  url = url.replace(/:senador-id:/, senador.id)

  return scraperjs.StaticScraper.create()
    .get(url)
    .scrape($ => {
      const oficiales = $('table').first().find('tr:not(:first-child)').map(function () {
        const nombreOficial = $(this).find('td:nth-child(1)').text().trim()
        const total = parseInt($(this).find('td:nth-child(2)').text().trim())
        const asiste = parseInt($(this).find('td:nth-child(3)').text().trim())
        return {
          nombre: nombreOficial,
          total,
          asiste
        }
      }).get()
      const otras = $('table').last().find('tr:not(:first-child)').map(function () {
        const nombreOtra = $(this).find('td:nth-child(1)').text().trim()
        const reemplazante = parseInt($(this).find('td:nth-child(2)').text().trim())
        const asistente = parseInt($(this).find('td:nth-child(3)').text().trim())
        return {
          nombre: nombreOtra,
          reemplazante,
          asistente
        }
      }).get()
      if (incluyeSenador) {
        return {
          senador,
          periodo,
          oficiales,
          otras
        }
      }
      return {
        periodo,
        oficiales,
        otras
      }
    })
}

// Convert a period into a period id for web scrapping
// (obj|num) -> num
function getPeriodoComisiones (periodo) {
  assert.ok(typeof periodo === 'number' || periodo instanceof Date, '[senadores-asistencia]: El periodo ingresado debe ser un número o una fecha.')

  if (typeof periodo === 'number') {
    assert.ok(periodo <= new Date().getFullYear(), '[senadores-asistencia]: No se puede consultar por un periodo en el futuro')
    // if period < 2002 -> it is probably a legislature, so convert into a year for comissions
    if (periodo < 2002) {
      periodo = periods.filter(period => {
        return period.legislatura === periodo
      })[0].hasta.getFullYear()
      console.warn('[senadores-asistencia]: Solo se puede consultar por año en consultas de comisiones. Si un id de legislatura sucede en más de un año, solo se considerará el primero encontrado.')
    }
    assert.ok(periodo, '[senadores-asistencia]: Periodo de busqueda no encontrado')
    return periodo
  }
  if (periodo instanceof Date) {
    assert.ok(periodo.getFullYear() <= new Date().getFullYear(), '[senadores-asistencia]: No se puede consultar por un periodo en el futuro')
    return periodo.getFullYear()
  }
}

exports.getPeriodoSala = getPeriodoSala
exports.getAsistenciaSala = getAsistenciaSala
exports.getAsistenciaComisiones = getAsistenciaComisiones
exports.getPeriodoComisiones = getPeriodoComisiones
