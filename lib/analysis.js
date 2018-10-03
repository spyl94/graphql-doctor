const {
  parse,
  Source,
  getLocation,
  buildSchema,
  findBreakingChanges,
  findDangerousChanges,
  BreakingChangeType,
  DangerousChangeType
} = require('graphql')
const extractValues = require('extract-values')

const generateQuery = (repo, owner, ref, path) => `query {
  repository(name: "${repo}", owner: "${owner}") {
    object(expression: "${ref}:${path}") {
      ... on Blob {
        text
      }
    }
  }
}
`

async function analyseSchema (context, owner, repo, configuration) {
  const newResponse = await context.github.query(
    generateQuery(
      repo,
      owner,
      configuration.newSchemaRef,
      configuration.newSchemaPath
    )
  )
  if (!newResponse.repository.object) {
    context.log.error('Could not find your new schema !', configuration)
  }
  const newSDL = newResponse.repository.object.text

  const oldResponse = await context.github.query(
    generateQuery(
      repo,
      owner,
      configuration.oldSchemaRef,
      configuration.oldSchemaPath
    )
  )
  if (!oldResponse.repository.object) {
    context.log.error('Could not find your old schema !', configuration)
  }
  const oldSDL = oldResponse.repository.object.text

  const result = {
    breaking: false,
    identical: false,
    annotations: []
  }

  if (oldSDL === newSDL) {
    context.log.info('✔ No changes')
    result.identical = true
    return result
  }

  context.log.info('⚠ Changes detected !')

  const oldSchema = buildSchema(oldSDL)
  const newSchema = buildSchema(newSDL)

  const changeToAnnotation = change => {
    return {
      path: configuration.newSchemaPath,
      ...getChangeLocation(change),
      ...getChangeDescription(change),
      annotation_level: change.criticity === 'BREAKING' ? 'failure' : 'warning'
    }
  }

  const dangerousChanges = findDangerousChanges(oldSchema, newSchema)
  if (dangerousChanges.length !== 0) {
    context.log.info('Dangerous changes:')
    for (const change of dangerousChanges) {
      context.log.info('  ⚠ ' + change.description)
      change.schemaSDL = newSDL
      change.criticity = 'DANGER'
    }
  }

  const breakingChanges = findBreakingChanges(oldSchema, newSchema)
  if (breakingChanges.length !== 0) {
    context.log.info('BREAKING CHANGES:')
    for (const change of breakingChanges) {
      context.log.info('  ✖ ' + change.description)
      if (change.type === BreakingChangeType.FIELD_REMOVED) {
        change.schemaSDL = oldSDL
      } else {
        change.schemaSDL = newSDL
      }
      change.criticity = 'BREAKING'
    }
  }

  result.breaking = breakingChanges.length > 0

  const analysis = [...breakingChanges, ...dangerousChanges]

  result.annotations = analysis.map(changeToAnnotation)

  return result
}

const getChangeDescription = change => {
  let message = null
  if (change.type === BreakingChangeType.TYPE_REMOVED) {
    message =
      'Removing a type is a breaking change. It is preferable to deprecate and remove all references to this type first.'
  }
  if (change.type === BreakingChangeType.FIELD_REMOVED) {
    message =
      'Removing a field is a breaking change.\nIt is preferable to deprecate the field before removing it.'
  }
  if (change.type === BreakingChangeType.VALUE_REMOVED_FROM_ENUM) {
    message =
      'Removing a value is a breaking change.\nIt is preferable to deprecate the value before removing it.'
  }
  if (change.type === BreakingChangeType.REQUIRED_INPUT_FIELD_ADDED) {
    message =
      'Adding a non-null field to an existing input type will cause existing queries that use this input type to error because they will not provide a value for this new field.'
  }

  if (change.type === BreakingChangeType.ARG_CHANGED_KIND) {
    // if (safe_change_for_input_value) {
    // "Changing an input field from non-null to null is considered non-breaking"
    // }
    message =
      "Changing the type of a field's argument can cause existing queries that use this argument to error."
  }

  if (change.type === DangerousChangeType.VALUE_ADDED_TO_ENUM) {
    message =
      'Adding an enum value may break existing clients that were not\nprogramming defensively against an added case when querying an enum.'
  }
  if (change.type === DangerousChangeType.ARG_DEFAULT_VALUE_CHANGE) {
    message =
      'Changing the default value for an argument may change the runtime behaviour of a field if it was never provided.'
  }

  if (
    change.type === DangerousChangeType.OPTIONAL_ARG_ADDED ||
    change.type === DangerousChangeType.OPTIONAL_INPUT_FIELD_ADDED
  ) {
    message = 'Non breaking'
  }

  // The title that represents the annotation. The maximum size is 255 characters.
  return {
    message: message || change.description,
    title: change.description.substring(0, 254)
  }
}

const getChangeLocation = change => {
  let typeNameToLookFor = null
  let fieldNameToLookFor = null

  if (change.type === BreakingChangeType.FIELD_REMOVED) {
    const values = extractValues(
      change.description,
      '{typeName}.{fieldName} was removed.'
    )
    typeNameToLookFor = values.typeName
    fieldNameToLookFor = values.fieldName
  }
  if (change.type === BreakingChangeType.VALUE_REMOVED_FROM_ENUM) {
    const values = extractValues(
      change.description,
      `{value} was removed from enum type {typeName}.`
    )
    typeNameToLookFor = values.typeName
  }
  if (change.type === DangerousChangeType.VALUE_ADDED_TO_ENUM) {
    const values = extractValues(
      change.description,
      `{value} was added to enum type {typeName}.`
    )
    typeNameToLookFor = values.typeName
  }

  if (change.type === DangerousChangeType.OPTIONAL_ARG_ADDED) {
    const values = extractValues(
      change.description,
      `An optional arg {argName} on {typeName}.{fieldName} was added`
    )
    typeNameToLookFor = values.typeName
    fieldNameToLookFor = values.fieldName
  }

  if (change.type === DangerousChangeType.OPTIONAL_INPUT_FIELD_ADDED) {
    const values = extractValues(
      change.description,
      `An optional field {fieldName} on input type {typeName} was added.`
    )
    typeNameToLookFor = values.typeName
    fieldNameToLookFor = values.fieldName
  }

  if (change.type === DangerousChangeType.ARG_DEFAULT_VALUE_CHANGE) {
    const values = extractValues(
      change.description,
      `{oldTypeName}.{fieldName} arg {oldArgDefName} has changed defaultValue`
    )
    typeNameToLookFor = values.oldTypeName
    fieldNameToLookFor = values.fieldName
  }

  if (change.type === BreakingChangeType.FIELD_CHANGED_KIND) {
    const values = extractValues(
      change.description,
      `{typeName}.{fieldName} changed type from {oldFieldTypeString} to {newFieldTypeString}.`
    )
    typeNameToLookFor = values.typeName
    fieldNameToLookFor = values.fieldName
  }

  if (change.type === BreakingChangeType.ARG_CHANGED_KIND) {
    const values = extractValues(
      change.description,
      `{oldTypeName}.{fieldName} arg {oldArgDefName} has changed type from {oldArgDefType} to {newArgDefType}`
    )
    typeNameToLookFor = values.oldTypeName
    fieldNameToLookFor = values.fieldName
  }

  const ast = parse(change.schemaSDL)
  const findInAST = (definitions, typeName) => {
    let found = null
    definitions.forEach(def => {
      if (def.name && def.name.value === typeName) {
        found = def
      }
    })
    return found
  }

  if (!typeNameToLookFor) {
    console.warn(
      'Could not find typeName of :' + change.type + change.description
    )
    return { start_line: 1, end_line: 3 }
  }
  let element = findInAST(ast.definitions, typeNameToLookFor)

  if (!element) {
    // We could not find the element
    console.warn('Could not find element :' + typeNameToLookFor)
    return { start_line: 1, end_line: 3 }
  }

  if (fieldNameToLookFor) {
    const field = findInAST(element.fields, fieldNameToLookFor)
    if (!field) {
      console.warn('Could not find fieldNameToLookFor :' + fieldNameToLookFor)
    } else {
      element = field
    }
  }

  const source = new Source(change.schemaSDL)
  const location = getLocation(source, element.loc.start)

  return { start_line: location.line, end_line: location.line }
}

async function analyzeTree (context, owner, repo, sha) {
  const response = await context.github.repos.getContent({
    owner,
    repo,
    path: 'package.json',
    ref: sha
  })
  const packageJson = Buffer.from(response.data.content, 'base64').toString()
  const configuration = JSON.parse(packageJson)['graphql-doctor']

  // Process key
  return Promise.all(
    Object.keys(configuration).map(schema => {
      const analysis = {
        newSchemaPath: schema,
        newSchemaRef: sha,
        oldSchemaPath: configuration[schema].schemaPath,
        oldSchemaRef: configuration[schema].ref
      }
      return analyseSchema(context, owner, repo, analysis)
    })
  )
}

module.exports = analyzeTree
