const {
  BaseKonnector,
  requestFactory,
  log,
  scrape,
  saveFiles,
  errors
} = require('cozy-konnector-libs')
const request = requestFactory({
  // debug: true,
  cheerio: true,
  jar: true,
  json: false
})
const querystring = require('querystring')

const baseUrl = 'https://cfspart.impots.gouv.fr'

module.exports = new BaseKonnector(start)

async function start (fields) {
  await login(fields)
  const documents = await fetch()
  await saveFiles(documents, fields)
}

async function login (fields) {
  log('info', 'Logging in')
  let $
  try {
    $ = await request({
      method: 'POST',
      uri: `${baseUrl}/LoginMDP?op=c&url=`,
      form: {
        url: '',
        LMDP_Spi: fields.login,
        LMDP_Password: fields.password,
        LMDP_Spi_tmp: fields.login,
        LMDP_Password_tmp: fields.password
      }
    })
  } catch (err) {
    log('error', 'Website failed while trying to login')
    log('error', err.message)
    throw new Error(errors.VENDOR_DOWN)
  }

  const erreurs = $('.erreur:not(.pasvisible)')
  if (erreurs.length) {
    log('error', erreurs.eq(0).text().trim())
    throw new Error(errors.LOGIN_FAILED)
  }
}

async function fetch () {
  log('info', 'Fetching the list of documents')
  let $ = await request(`${baseUrl}/acces-usager/cfs`)

  // get the "Mes documents" link
  const documentsLink = $('img[name=doc]').closest('a').attr('href')
  const urlPrefix = documentsLink.split('/')[1] // gets "cesu-XX" from the url
  $ = await request(`${baseUrl}${documentsLink}`)

  const $form = $('form[name=documentsForm]')
  const formUrl = $form.attr('action')
  const token = $form.find('input[name=CSRFTOKEN]').val()

  $ = await request({
    method: 'POST',
    uri: `${baseUrl}${formUrl}`,
    form: {
      annee: 'all',
      CSRFTOKEN: token,
      method: 'rechercheDocuments',
      typeDocument: 'toutDocument',
      typeImpot: 'toutImpot'
    }
  })

  const documents = scrape($, {
    fileurl: {
      attr: 'onclick',
      parse: onclick => {
        const viewerUrl = onclick.match(/\((.*)\)/)[1].split(',')[0].slice(1, -1)
        return `${baseUrl}/${urlPrefix}/${viewerUrl}`
      }
    },
    name: {
      fn: link => {
        return $(link).closest('tr').text()
      }
    }
  }, '.cssLienTable')

  log('info', `Found ${documents.length} documents to download`)

  const result = []
  for (let doc of documents) {
    log('debug', `Fetching doc url for ${doc.name}`)
    const $ = await request(doc.fileurl)
    result.push({
      fileurl: `${baseUrl}${$('iframe').attr('src')}`,
      name: doc.name
    })
  }

  return result.map(doc => {
    if (doc.fileurl.match(/ConsultAR/)) {
      // we have an "accusé de reception" without a file name
      log('info', 'Old accuse de reception without filename')
      const {typeForm, annee, numeroAdonis} = querystring.parse(doc.fileurl)
      doc.filename = `IR-${typeForm}--${annee}-${numeroAdonis}.pdf`
      log('info', 'Changed filename to ' + doc.filename)
    }
    return doc
  })
}
