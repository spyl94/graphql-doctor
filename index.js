/* eslint-disable camelcase */
const handler = require('./lib/handler')

/**
 * This is the entry point for your Probot App.
 * @param {import('probot').Application} app - Probot's Application class.
 */
module.exports = app => {
  app.log('App loaded, waiting for events!')

  app.on('check_run', async context => {
    const { action, check_run } = context.payload
    const { owner, repo } = context.repo()
    const { head_sha: sha } = check_run

    return handler({ context, action, owner, repo, sha })
  })

  app.on('check_suite', async context => {
    const { action, check_suite } = context.payload
    const { owner, repo } = context.repo()
    const { head_sha: sha } = check_suite

    return handler({ context, action, owner, repo, sha })
  })
}
