const { Application } = require('probot')
// Requiring our app implementation
const myProbotApp = require('..')
const handler = require('../lib/handler')

const checkRunPayload = require('./fixtures/check_run.json')
const checkRunInProgressPayload = require('./fixtures/check_run_in_progress.json')

const packageJSON = `
{
  "graphql-doctor": {
    "schema.graphql": { "ref": "heads/master", "schemaPath": "schema.graphql"}
  }
}
`
const oldSchema = `
type Author {
    id: Int!
    firstName: String
    lastName: String
    """
    the list of Posts by this author
    """
    posts: [Post]
  }

  enum UserRole {
    ROLE_ADMIN
    ROLE_USER
  }

  type Post {
    id: Int!
    title: String
    author: Author
    votes: Int
  }

  # the schema allows the following query:
  type Query {
    posts: [Post]
    author(id: Int! = 1): Author
  }

  # this schema allows the following mutation:
  type Mutation {
    upvotePost (
      postId: Int
    ): Post
  }
`

const newSchema = `
type Author {
    id: Int!
    lastName: String
    """
    the list of Posts by this author
    """
    posts: [Post]
  }

  type Post {
    id: Int
    title: String
    author: Author!
    votes: Int
  }

  # the schema allows the following query:
  type Query {
    posts: [Post]
    author(id: Int! = 2, includeIfDeleted: Boolean): Author
  }

  enum UserRole {
    ROLE_USER
    ROLE_NEW
  }

  # this schema allows the following mutation:
  type Mutation {
    upvotePost (
      postId: Int!
    ): Post
  }
`

describe('My Probot app', () => {
  let app, github

  beforeEach(() => {
    app = new Application()
    // Initialize the app based on the code from index.js
    app.load(myProbotApp)
    // This is an easy way to mock out the GitHub API
    github = {
      query: jest
        .fn()
        // First is new schema.graphql
        .mockReturnValueOnce(
          Promise.resolve({
            repository: { object: { text: newSchema } }
          })
        )
        // Second is old schema.graphql
        .mockReturnValueOnce(
          Promise.resolve({
            repository: { object: { text: oldSchema } }
          })
        ),
      repos: {
        getContent: jest
          .fn()
          // First is package.json
          .mockReturnValueOnce(
            Promise.resolve({
              data: { content: Buffer.from(packageJSON).toString('base64') }
            })
          )
      },
      request: jest
        .fn()
        .mockReturnValue(Promise.resolve({ data: checkRunInProgressPayload }))
    }
    // Passes the mocked out GitHub API into out app instance
    app.auth = () => Promise.resolve(github)
  })

  test('analyse a check_run', async () => {
    await app.receive({
      name: 'check_run',
      payload: checkRunPayload
    })
    expect(github.request).toHaveBeenCalled()
  })
  test('analyse a check_run', async () => {
    const context = { github, log: { info: jest.fn(), trace: jest.fn() } }
    const result = await handler({
      context,
      action: 'requested',
      owner: 'cap-collectif',
      repo: 'platform',
      sha: 'sha'
    })
    expect(result).toMatchSnapshot()
  })
})
