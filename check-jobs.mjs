import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute('SELECT id, userName, fileType, fileName, status, totalRows, processedRows, successRows, errorRows, errorMessage, createdAt, completedAt FROM importJobs ORDER BY id DESC LIMIT 10');
console.log(JSON.stringify(rows, null, 2));
await conn.end();
