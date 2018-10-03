/* eslint-disable camelcase */
const analyzeTree = require('./analysis')
const mediaType = 'application/vnd.github.antiope-preview+json'
const headers = { headers: { accept: mediaType } }

module.exports = async ({ context, action, owner, repo, sha }) => {
  context.log.trace(`action is "${action}".`)
  context.log.trace(`repo is "${owner}/${repo}".`)
  context.log.trace(`sha is "${sha}".`)

  if (['requested', 'rerequested'].includes(action)) {
    context.log.trace('creating in_progress check run...')

    let url = `https://api.github.com/repos/${owner}/${repo}/check-runs`
    const startCheckRun = await context.github.request(
      Object.assign(
        {
          method: 'POST',
          url: url,
          name: 'schema-diff',
          head_sha: sha,
          status: 'in_progress',
          started_at: new Date().toISOString()
        },
        headers
      )
    )

    const {
      data: { id: check_run_id, url: check_run_url }
    } = startCheckRun
    context.log.trace('result is %j.', startCheckRun)
    context.log.trace(`check_run_id is ${check_run_id}.`)
    context.log.trace(`check_run_url is ${check_run_url}.`)

    // Process in this repo
    const analyzeTreeResults = await analyzeTree(context, owner, repo, sha)

    const analysis = analyzeTreeResults[0]
    const count = analysis.annotations.length

    context.log.trace('annotations (%d) are %j', count, analysis.annotations)

    // Provide feedback
    // https://developer.github.com/v3/checks/runs/#update-a-check-run
    // PATCH /repos/:owner/:repo/check-runs/:check_run_id

    // Send annotations in batches of (up to) 50
    while (analysis.annotations.length > 0) {
      let batch = analysis.annotations.splice(0, 50)
      context.log.info(`sending batch of ${batch.length}`)
      const pathCheckRun = await context.github.request(
        Object.assign(
          {
            method: 'PATCH',
            url: check_run_url,
            output: {
              title: `GraphQL doctor found ${count} issue${
                count === 1 ? '' : 's'
              }`,
              summary: `It looks like your pull request includes changes to our GraphQL schema that requires your attention.`,
              annotations: batch
            }
          },
          headers
        )
      )
      context.log.trace('result is %j', pathCheckRun)
    }

    // Complete the check run
    await context.github.request(
      Object.assign(
        {
          method: 'PATCH',
          url: check_run_url,
          status: 'completed',
          conclusion: analysis.breaking
            ? 'action_required'
            : analysis.identical
              ? 'success'
              : 'neutral',
          completed_at: new Date().toISOString()
        },
        headers
      )
    )

    return analysis
  }
}
