/** CSV fixtures for /api/import integration tests (match seeded org data). */
export const IMPORT_CSV_FIXTURES = {
  families: {
    content: 'name,weddingDate,email\nImport Family,2018-05-01,import-family@example.com',
    mime: 'text/csv',
    filename: 'families.csv',
  },
  members: {
    content:
      'familyName,firstName,lastName,birthDate,gender\nAPI Route Marker Family,Import,Child,2012-04-15,female',
    mime: 'text/csv',
    filename: 'members.csv',
  },
  payments: {
    content:
      'familyName,amount,paymentDate,type,paymentMethod\nAPI Route Marker Family,75,2024-06-15,membership,check',
    mime: 'text/csv',
    filename: 'payments.csv',
  },
  lifecycleEvents: {
    content:
      'familyName,eventType,eventDate,amount\nAPI Route Marker Family,bar_mitzvah,2024-08-01,500',
    mime: 'text/csv',
    filename: 'lifecycle-events.csv',
  },
} as const
