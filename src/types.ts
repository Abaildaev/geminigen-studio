export interface AnimationTask {
  id: string;
  file: File;
  previewUrl: string;
  fileName: string;
  width: number;
  height: number;
  
  // Generation parameters
  model: 'grok-3' | 'veo-3.1-fast';
  prompt: string;
  aspectRatio: 'portrait' | 'landscape' | '9:16' | '16:9';
  resolution: '480p' | '720p' | '1080p';
  duration: string; // "6", "10", "15" for grok, "8" for veo
  
  // Task status
  status: 'idle' | 'submitting' | 'polling' | 'completed' | 'failed';
  progress: number; // 0 to 100
  uuid?: string;
  error?: string;
  videoUrl?: string;
  createdAt?: string;
}

export interface ApiSubmitResponse {
  uuid: string;
  status: number;
  model_name: string;
}

export interface ApiHistoryItem {
  uuid: string;
  status: number;
  status_percentage?: number;
  model_name?: string;
  generated_video?: Array<{ video_url: string }>;
  media_url?: string;
  thumbnail_url?: string;
  generate_result?: string;
  error_message?: string | null;
  created_at?: string;
}

export interface ApiHistoryResponse {
  result: ApiHistoryItem | { result: ApiHistoryItem } | any;
}

// ---- Image Generation Types ----

export type ImageModel = 'nano-banana-pro' | 'nano-banana-2' | 'imagen-4' | 'gpt-image-2';

export type ImageAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9' | '3:2' | '2:3';

export type ImageOutputFormat = 'jpeg' | 'png';

export type ImageResolution = '1K' | '2K' | '4K' | '8K' | '10K' | '12K';

export type ImageStyle = 
  | 'None'
  | '3D Render'
  | 'Acrylic'
  | 'Anime General'
  | 'Creative'
  | 'Dynamic'
  | 'Fashion'
  | 'Game Concept'
  | 'Graphic Design 3D'
  | 'Illustration'
  | 'Photorealistic'
  | 'Portrait'
  | 'Portrait Cinematic'
  | 'Portrait Fashion'
  | 'Ray Traced'
  | 'Stock Photo'
  | 'Watercolor';

export interface ImageGenTask {
  id: string;
  prompt: string;

  // Generation parameters
  model: ImageModel;
  aspectRatio: ImageAspectRatio;
  style: ImageStyle;
  outputFormat: ImageOutputFormat;
  resolution: ImageResolution;

  // GPT Image 2 specific parameters
  gptMode?: 'low' | 'medium' | 'high';
  refHistory?: string;

  // Optional reference image
  referenceFile?: File;
  referencePreviewUrl?: string;
  referenceFileName?: string;

  // Task status
  status: 'idle' | 'submitting' | 'polling' | 'completed' | 'failed';
  progress: number; // 0 to 100
  uuid?: string;
  error?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
}

export interface StyleTransferTask {
  id: string;
  prompt: string;

  // Generation parameters
  model: ImageModel;
  aspectRatio: ImageAspectRatio;
  style: ImageStyle;
  outputFormat: ImageOutputFormat;
  resolution: ImageResolution;

  // Reference image (provides style)
  referenceFile?: File;
  referencePreviewUrl?: string;
  referenceFileName?: string;

  // Subject image (provides content/face to be styled)
  subjectFile?: File;
  subjectPreviewUrl?: string;
  subjectFileName?: string;

  // Task status
  status: 'idle' | 'submitting' | 'polling' | 'completed' | 'failed';
  progress: number; // 0 to 100
  uuid?: string;
  error?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  promptMode?: 'structured' | 'simple';
}

