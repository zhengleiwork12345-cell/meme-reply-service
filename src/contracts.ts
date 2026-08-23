import { z } from 'zod';
export const moods = ['搞笑', '嘲讽', '无语', '震惊', '求饶', '开心', '得意', '安慰', '反击'] as const;
export type Mood = typeof moods[number];
export const formSchema = z.object({ mood: z.enum(moods), replyText: z.string().max(30).optional().transform(value => value?.trim() || undefined) });
export type GenerationRequest = { source: { bytes: Buffer; mimeType: 'image/jpeg' | 'image/png'; filename: string }; mood: Mood; replyText?: string };
export type GenerationResponse = { requestId: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; imageBase64: string };
export type ErrorResponse = { requestId: string; code: string; message: string };
