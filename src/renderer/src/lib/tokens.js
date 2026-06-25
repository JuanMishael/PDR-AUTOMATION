// Single source of truth for the dynamic tokens a tester can drop into any input.
//
// Both the in-step {{ }} Token Picker (TokenField.jsx) and the Help → Tokens
// cheat-sheet render from this list, so they can never drift apart. Every faker
// path here is verified against the installed @faker-js/faker (v10) — an unknown
// path resolves to an empty string silently (see tokenResolver.js resolveFaker),
// so only ship paths you've confirmed exist.
//
// Resolution lives in src/main/core/tokenResolver.js. Keep the two in sync:
//   {{unique.*}} special cases  -> resolveUnique()
//   {{faker.*}}  arbitrary path -> resolveFaker()

export const TOKEN_GROUPS = [
  {
    name: 'Unique (never collides)',
    hint: 'Fresh every run, stable within one run. Use for values that must be unique each time — new account emails, reference codes.',
    tokens: [
      { token: '{{unique.email}}',     label: 'Unique email',     desc: 'test+<time><rand>@example.com' },
      { token: '{{unique.ref}}',       label: 'Unique reference', desc: 'ref-<time>-<rand> — any word after unique. works' },
      { token: '{{unique.number}}',    label: 'Unique number',    desc: '6 digits from the clock' },
      { token: '{{unique.timestamp}}', label: 'Timestamp',        desc: 'Milliseconds since epoch' },
      { token: '{{unique.uuid}}',      label: 'Unique UUID',      desc: 'A v4 UUID, e.g. 3f1c…' }
    ]
  },
  {
    name: 'Dates & time (ISO)',
    hint: 'Current date/time in ISO 8601 — what SOAP (xsd:dateTime) and most JSON APIs expect.',
    tokens: [
      { token: '{{now}}',          label: 'Now (ISO)',      desc: 'Full ISO datetime, e.g. 2026-06-25T09:12:33.000Z' },
      { token: '{{now.datetime}}', label: 'Now (no ms)',    desc: 'e.g. 2026-06-25T09:12:33' },
      { token: '{{now.date}}',     label: 'Today',          desc: 'Date only, e.g. 2026-06-25' },
      { token: '{{now.time}}',     label: 'Time only',      desc: 'e.g. 09:12:33' },
      { token: '{{unique.timestamp}}', label: 'Epoch ms',   desc: 'Milliseconds since 1970, e.g. 1782326758261' }
    ]
  },
  {
    name: 'Name & person',
    hint: 'Realistic fake people.',
    tokens: [
      { token: '{{faker.person.firstName}}', label: 'First name', desc: 'e.g. Maria' },
      { token: '{{faker.person.lastName}}',  label: 'Last name',  desc: 'e.g. Santos' },
      { token: '{{faker.person.fullName}}',  label: 'Full name',  desc: 'e.g. Maria Santos' },
      { token: '{{faker.person.prefix}}',    label: 'Prefix',     desc: 'Mr, Mrs, Dr…' },
      { token: '{{faker.person.jobTitle}}',  label: 'Job title',  desc: 'e.g. Sales Manager' }
    ]
  },
  {
    name: 'Internet & contact',
    hint: 'Emails, logins, phone numbers.',
    tokens: [
      { token: '{{faker.internet.email}}',    label: 'Email',     desc: 'Realistic random email' },
      { token: '{{faker.internet.username}}', label: 'Username',  desc: 'e.g. maria.santos88' },
      { token: '{{faker.internet.password}}', label: 'Password',  desc: 'Random password string' },
      { token: '{{faker.internet.url}}',      label: 'URL',       desc: 'e.g. https://example.org' },
      { token: '{{faker.phone.number}}',      label: 'Phone',     desc: 'Random phone number' }
    ]
  },
  {
    name: 'Address',
    hint: 'Street, city, region, postcode.',
    tokens: [
      { token: '{{faker.location.streetAddress}}', label: 'Street address', desc: 'e.g. 123 Main St' },
      { token: '{{faker.location.city}}',          label: 'City',           desc: 'e.g. Quezon City' },
      { token: '{{faker.location.state}}',         label: 'State / region', desc: 'e.g. Metro Manila' },
      { token: '{{faker.location.zipCode}}',       label: 'Zip / postcode', desc: 'e.g. 1100' },
      { token: '{{faker.location.country}}',       label: 'Country',        desc: 'e.g. Philippines' }
    ]
  },
  {
    name: 'Text & words',
    hint: 'Filler text for notes, descriptions, search boxes.',
    tokens: [
      { token: '{{faker.lorem.word}}',      label: 'A word',     desc: 'One random word' },
      { token: '{{faker.lorem.words}}',     label: 'A few words', desc: 'A short string of words' },
      { token: '{{faker.lorem.sentence}}',  label: 'A sentence', desc: 'One random sentence' },
      { token: '{{faker.lorem.paragraph}}', label: 'A paragraph', desc: 'A block of text' },
      { token: '{{faker.commerce.productName}}', label: 'Product name', desc: 'e.g. Ergonomic Cotton Shirt' }
    ]
  },
  {
    name: 'Numbers, dates & IDs',
    hint: 'Quantities, prices, dates, identifiers.',
    tokens: [
      { token: '{{faker.number.int}}',     label: 'Whole number', desc: 'A random integer' },
      { token: '{{faker.commerce.price}}', label: 'Price',        desc: 'e.g. 499.00' },
      { token: '{{faker.string.uuid}}',    label: 'UUID',         desc: 'A v4 UUID' },
      { token: '{{faker.string.numeric}}', label: 'Digits',       desc: 'A random numeric string' },
      { token: '{{faker.date.recent}}',    label: 'Recent date',  desc: 'An ISO date in the last few days' },
      { token: '{{faker.date.birthdate}}', label: 'Birthdate',    desc: 'A plausible ISO date of birth' }
    ]
  }
]

// Flat list (handy for search/iteration without caring about grouping).
export const ALL_TOKENS = TOKEN_GROUPS.flatMap(g => g.tokens)
