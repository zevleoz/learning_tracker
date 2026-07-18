import { checkTimeConflict, toTimeStr, parseTimeStr, calculateDuration } from '../src/utils/timeUtils';

describe('timeUtils', () => {
  describe('checkTimeConflict', () => {
    const existingSessions = [
      { id: 1, start_time: '09:00:00', end_time: '10:00:00' },
      { id: 2, start_time: '14:00:00', end_time: '15:30:00' },
    ];

    it('should return null when no conflict', () => {
      const result = checkTimeConflict('10:30:00', '11:30:00', existingSessions);
      expect(result).toBeNull();
    });

    it('should detect full overlap', () => {
      const result = checkTimeConflict('09:15:00', '09:45:00', existingSessions);
      expect(result).not.toBeNull();
      expect(result.id).toBe(1);
    });

    it('should detect partial overlap at start', () => {
      const result = checkTimeConflict('08:30:00', '09:30:00', existingSessions);
      expect(result).not.toBeNull();
      expect(result.id).toBe(1);
    });

    it('should detect partial overlap at end', () => {
      const result = checkTimeConflict('09:30:00', '10:30:00', existingSessions);
      expect(result).not.toBeNull();
      expect(result.id).toBe(1);
    });

    it('should detect exact start match', () => {
      const result = checkTimeConflict('09:00:00', '09:30:00', existingSessions);
      expect(result).not.toBeNull();
      expect(result.id).toBe(1);
    });

    it('should detect exact end match', () => {
      const result = checkTimeConflict('09:30:00', '10:00:00', existingSessions);
      expect(result).not.toBeNull();
      expect(result.id).toBe(1);
    });

    it('should return null when touching at end', () => {
      const result = checkTimeConflict('10:00:00', '11:00:00', existingSessions);
      expect(result).toBeNull();
    });

    it('should return null when touching at start', () => {
      const result = checkTimeConflict('08:00:00', '09:00:00', existingSessions);
      expect(result).toBeNull();
    });

    it('should return null with empty existing sessions', () => {
      const result = checkTimeConflict('09:00:00', '10:00:00', []);
      expect(result).toBeNull();
    });

    it('should return null with null existing sessions', () => {
      const result = checkTimeConflict('09:00:00', '10:00:00', null);
      expect(result).toBeNull();
    });

    it('should detect conflict in second session', () => {
      const result = checkTimeConflict('14:30:00', '15:00:00', existingSessions);
      expect(result).not.toBeNull();
      expect(result.id).toBe(2);
    });
  });

  describe('toTimeStr', () => {
    it('should format time correctly', () => {
      const date = new Date(2024, 0, 1, 9, 5);
      expect(toTimeStr(date)).toBe('09:05');
    });

    it('should pad single digit hours', () => {
      const date = new Date(2024, 0, 1, 5, 30);
      expect(toTimeStr(date)).toBe('05:30');
    });

    it('should pad single digit minutes', () => {
      const date = new Date(2024, 0, 1, 12, 5);
      expect(toTimeStr(date)).toBe('12:05');
    });
  });

  describe('parseTimeStr', () => {
    it('should parse time string correctly', () => {
      const result = parseTimeStr('09:30');
      expect(result.getHours()).toBe(9);
      expect(result.getMinutes()).toBe(30);
      expect(result.getSeconds()).toBe(0);
    });

    it('should handle two-digit hours', () => {
      const result = parseTimeStr('14:20');
      expect(result.getHours()).toBe(14);
      expect(result.getMinutes()).toBe(20);
    });
  });

  describe('calculateDuration', () => {
    it('should calculate duration correctly', () => {
      expect(calculateDuration('09:00', '10:00')).toBe(60);
    });

    it('should calculate partial hour duration', () => {
      expect(calculateDuration('09:15', '10:00')).toBe(45);
    });

    it('should handle cross-day duration', () => {
      expect(calculateDuration('23:30', '00:30')).toBe(60);
    });

    it('should handle same time', () => {
      expect(calculateDuration('12:00', '12:00')).toBe(0);
    });
  });
});