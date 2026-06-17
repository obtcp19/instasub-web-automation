import { Client } from 'pg';

export class DatabaseHelper {
  private client: Client;

  constructor(connectionString: string) {
    this.client = new Client({ connectionString });
  }

  async connect() {
    await this.client.connect();
  }

  async disconnect() {
    await this.client.end();
  }

  async getAbsenceByConfirmationNumber(confirmationNumber: string): Promise<any> {
    const result = await this.client.query(
      'SELECT * FROM absences WHERE confirmation_number = $1',
      [confirmationNumber]
    );
    return result.rows[0] || null;
  }

  async deleteAbsencesByTeacher(teacherName: string) {
    await this.client.query(
      'DELETE FROM absences WHERE teacher_name = $1',
      [teacherName]
    );
  }

  async countAbsencesForTeacher(teacherName: string): Promise<number> {
    const result = await this.client.query(
      'SELECT COUNT(*) as count FROM absences WHERE teacher_name = $1',
      [teacherName]
    );
    return parseInt(result.rows[0].count, 10);
  }
}
