import { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Trash2,
  RefreshCw,
  Loader2,
  Download,
  Play,
  Plus,
  Image as ImageIcon,
  Copy,
  X,
  AlertCircle,
  CheckCircle2,
  Wand2,
  Palette,
  Maximize2,
  ArrowRight,
} from 'lucide-react';
import JSZip from 'jszip';
import type {
  StyleTransferTask,
  ImageModel,
  ImageAspectRatio,
  ImageStyle,
  ImageOutputFormat,
  ImageResolution,
} from './types';

const IMAGE_MODELS: { value: ImageModel; label: string; desc: string }[] = [
  { value: 'nano-banana-pro', label: 'Nano Banana Pro', desc: 'Рекомендуется. Высокая точность, понимание деталей' },
  { value: 'nano-banana-2', label: 'Nano Banana 2', desc: 'Быстрая генерация' },
  { value: 'imagen-4', label: 'Imagen 4', desc: 'Баланс скорости и качества' },
];

const IMAGE_STYLES: ImageStyle[] = [
  'None', '3D Render', 'Acrylic', 'Anime General', 'Creative', 'Dynamic',
  'Fashion', 'Game Concept', 'Graphic Design 3D', 'Illustration',
  'Photorealistic', 'Portrait', 'Portrait Cinematic', 'Portrait Fashion',
  'Ray Traced', 'Stock Photo', 'Watercolor',
];

const ASPECT_RATIOS: { value: ImageAspectRatio; label: string; icon: string }[] = [
  { value: '1:1', label: '1:1', icon: '⬜' },
  { value: '16:9', label: '16:9', icon: '🖥️' },
  { value: '9:16', label: '9:16', icon: '📱' },
  { value: '4:3', label: '4:3', icon: '📺' },
  { value: '3:4', label: '3:4', icon: '🖼️' },
];

const RESOLUTIONS: ImageResolution[] = ['1K', '2K', '4K'];
const OUTPUT_FORMATS: ImageOutputFormat[] = ['jpeg', 'png'];

interface Props {
  apiKey: string;
}

export default function StyleTransfer({ apiKey }: Props) {
  // Tasks Queue
  const [tasks, setTasks] = useState<StyleTransferTask[]>([]);

  // Global defaults
  const [globalModel, setGlobalModel] = useState<ImageModel>('nano-banana-pro');
  const [globalStyle, setGlobalStyle] = useState<ImageStyle>('None');
  const [globalAspectRatio, setGlobalAspectRatio] = useState<ImageAspectRatio>('1:1');
  const [globalResolution, setGlobalResolution] = useState<ImageResolution>('1K');
  const [globalFormat, setGlobalFormat] = useState<ImageOutputFormat>('png');
  const [globalPromptMode, setGlobalPromptMode] = useState<'structured' | 'simple'>('structured');

  // Queue controller
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState('');
  const queueTimeoutRef = useRef<any>(null);
  const activePolls = useRef<{ [taskId: string]: any }>({});

  // Task logs
  const [taskLogs, setTaskLogs] = useState<{ [taskId: string]: string[] }>({});

  // Lightbox
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      Object.values(activePolls.current).forEach(clearInterval);
      if (queueTimeoutRef.current) clearTimeout(queueTimeoutRef.current);
    };
  }, []);

  const addLog = (taskId: string, message: string) => {
    const time = new Date().toLocaleTimeString();
    setTaskLogs((prev) => ({
      ...prev,
      [taskId]: [...(prev[taskId] || []), `[${time}] ${message}`],
    }));
  };

  // ---- Task Management ----
  const addEmptyTask = () => {
    const id = `st-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newTask: StyleTransferTask = {
      id,
      prompt: 'сделай мне photo_2 точно такую же фотографию как на фото photo_1',
      model: globalModel,
      aspectRatio: globalAspectRatio,
      style: globalStyle,
      outputFormat: globalFormat,
      resolution: globalResolution,
      status: 'idle',
      progress: 0,
      promptMode: globalPromptMode,
    };
    setTasks((prev) => [...prev, newTask]);
    addLog(id, 'Создана новая задача переноса стиля');
  };

  const addMultipleEmptyTasks = (count: number) => {
    const newTasks: StyleTransferTask[] = Array.from({ length: count }, (_, i) => {
      const id = `st-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;
      return {
        id,
        prompt: 'сделай мне photo_2 точно такую же фотографию как на фото photo_1',
        model: globalModel,
        aspectRatio: globalAspectRatio,
        style: globalStyle,
        outputFormat: globalFormat,
        resolution: globalResolution,
        status: 'idle' as const,
        progress: 0,
        promptMode: globalPromptMode,
      };
    });
    setTasks((prev) => [...prev, ...newTasks]);
    newTasks.forEach((t) => addLog(t.id, 'Создана новая задача переноса стиля'));
  };

  const duplicateTask = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const newId = `st-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // In React, reusing file objects is fine, but we can copy the task object
    const copy: StyleTransferTask = {
      ...task,
      id: newId,
      status: 'idle',
      progress: 0,
      uuid: undefined,
      error: undefined,
      imageUrl: undefined,
      thumbnailUrl: undefined,
    };
    setTasks((prev) => [...prev, copy]);
    addLog(newId, `Дубликат задачи «${task.prompt.slice(0, 40)}...»`);
  };

  const updateTaskField = (id: string, field: keyof StyleTransferTask, value: any) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, [field]: value } : t)));
  };

  const removeTask = (id: string) => {
    if (activePolls.current[id]) {
      clearInterval(activePolls.current[id]);
      delete activePolls.current[id];
    }
    setTasks((prev) => {
      const task = prev.find((t) => t.id === id);
      if (task?.referencePreviewUrl) URL.revokeObjectURL(task.referencePreviewUrl);
      if (task?.subjectPreviewUrl) URL.revokeObjectURL(task.subjectPreviewUrl);
      return prev.filter((t) => t.id !== id);
    });
    setTaskLogs((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const clearQueue = () => {
    Object.values(activePolls.current).forEach(clearInterval);
    activePolls.current = {};
    tasks.forEach((t) => {
      if (t.referencePreviewUrl) URL.revokeObjectURL(t.referencePreviewUrl);
      if (t.subjectPreviewUrl) URL.revokeObjectURL(t.subjectPreviewUrl);
    });
    setTasks([]);
    setTaskLogs({});
    setIsProcessingAll(false);
  };

  // ---- Image Upload Handlers ----
  const handleRefUpload = (taskId: string, file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, referenceFile: file, referencePreviewUrl: previewUrl, referenceFileName: file.name }
          : t
      )
    );
    addLog(taskId, `Загружен референс стиля: ${file.name}`);
  };

  const removeRefImage = (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === taskId && t.referencePreviewUrl) {
          URL.revokeObjectURL(t.referencePreviewUrl);
          return { ...t, referenceFile: undefined, referencePreviewUrl: undefined, referenceFileName: undefined };
        }
        return t;
      })
    );
  };

  const handleSubjUpload = (taskId: string, file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, subjectFile: file, subjectPreviewUrl: previewUrl, subjectFileName: file.name }
          : t
      )
    );
    addLog(taskId, `Загружен субъект (ваше фото): ${file.name}`);
  };

  const removeSubjImage = (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === taskId && t.subjectPreviewUrl) {
          URL.revokeObjectURL(t.subjectPreviewUrl);
          return { ...t, subjectFile: undefined, subjectPreviewUrl: undefined, subjectFileName: undefined };
        }
        return t;
      })
    );
  };

  // Apply global settings to all idle/failed tasks
  const applyGlobalSettings = () => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.status === 'idle' || t.status === 'failed') {
          return {
            ...t,
            model: globalModel,
            style: globalStyle,
            aspectRatio: globalAspectRatio,
            resolution: globalResolution,
            outputFormat: globalFormat,
            promptMode: globalPromptMode,
          };
        }
        return t;
      })
    );
  };

  // ---- API Submission ----
  const submitTask = async (task: StyleTransferTask): Promise<string> => {
    if (!apiKey) throw new Error('API ключ не задан');
    if (!task.referenceFile) throw new Error('Референс стиля обязателен');
    if (!task.subjectFile) throw new Error('Фото субъекта обязательно');

    addLog(task.id, `Подготовка запроса переноса стиля через модель ${task.model}...`);

    const formData = new FormData();
    
    const promptMode = task.promptMode || 'structured';
    let systemInstruction = '';
    
    if (promptMode === 'simple') {
      systemInstruction = 
        `Take the person/face from photo_2 (input_file_1.png) and make the exact same photo as photo_1 (input_file_0.png) — same pose, same clothes, same background, same composition. ` +
        `Execute request: "сделай мне photo_2 точно такую же фотографию как на фото photo_1"`;
    } else {
      systemInstruction = 
        `IDENTITY AND FACE SWAP TASK:\n` +
        `You are given two input images:\n` +
        `- input_file_0.png (the first image / photo_1): This is the TARGET SCENE. You must copy the pose, clothing, background, lighting, and composition of this image EXACTLY.\n` +
        `- input_file_1.png (the second image / photo_2): This is the FACE/IDENTITY SOURCE. You must take the face, facial features, identity, eyes, nose, mouth, haircut, and head shape of the person in input_file_1.png and place them onto the body and scene in input_file_0.png.\n\n` +
        `CRITICAL INSTRUCTIONS:\n` +
        `1. Replace the face and identity of the person in the first image (input_file_0.png) with the face and identity of the person from the second image (input_file_1.png).\n` +
        `2. Do NOT keep the face or facial features of the person from the first image. The face of the final person must look exactly like the person in the second image.\n` +
        `3. Keep the background, pose, body, clothing, and camera angle identical to the first image (input_file_0.png).\n\n` +
        `User request: "${task.prompt || 'сделай мне photo_2 точно такую же фотографию как на фото photo_1'}"`;
    }

    formData.append('prompt', systemInstruction);
    formData.append('model', task.model);
    formData.append('aspect_ratio', task.aspectRatio);
    formData.append('style', task.style);
    formData.append('output_format', task.outputFormat);
    formData.append('resolution', task.resolution);

    // Append files (first is style reference, second is subject)
    formData.append('files', task.referenceFile, `style_${task.referenceFileName || 'ref.jpg'}`);
    formData.append('files', task.subjectFile, `subject_${task.subjectFileName || 'subj.jpg'}`);

    addLog(task.id, `Прикреплены файлы: ${task.referenceFileName} (Стиль) и ${task.subjectFileName} (Субъект)`);

    const endpoint = '/api/uapi/v1/generate_image';
    addLog(task.id, `Отправка к ${endpoint}...`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      addLog(task.id, `Ответ API (${response.status}): ${errText.slice(0, 500)}`);
      let errMsg = `HTTP ${response.status}`;
      try {
        const errJson = JSON.parse(errText);
        const raw = errJson.error_message || errJson.message || errJson.detail || errJson.error;
        if (raw) {
          errMsg = typeof raw === 'string' ? raw : JSON.stringify(raw);
        } else {
          errMsg += `: ${JSON.stringify(errJson).slice(0, 400)}`;
        }
      } catch {
        if (errText) errMsg += `: ${errText.slice(0, 400)}`;
      }
      throw new Error(errMsg);
    }

    const data = await response.json();
    if (!data.uuid) throw new Error('API не вернул UUID');

    addLog(task.id, `Задача создана! UUID: ${data.uuid}`);

    // Check if completed instantly
    if (data.status === 2 && data.generate_result) {
      addLog(task.id, `Генерация завершена мгновенно!`);
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                status: 'completed',
                progress: 100,
                imageUrl: data.generate_result,
                thumbnailUrl: data.thumbnail_small,
                uuid: data.uuid,
              }
            : t
        )
      );
      return data.uuid;
    }

    return data.uuid;
  };

  // ---- Polling ----
  const startPolling = (taskId: string, uuid: string) => {
    if (activePolls.current[taskId]) {
      clearInterval(activePolls.current[taskId]);
    }

    addLog(taskId, `Опрос статуса каждые 4 сек для UUID: ${uuid}`);

    const checkStatus = async () => {
      try {
        const response = await fetch(`/api/uapi/v1/history/${uuid}`, {
          headers: { 'x-api-key': apiKey },
        });

        if (!response.ok) {
          addLog(taskId, `Предупреждение: HTTP ${response.status}`);
          return;
        }

        const data = await response.json();
        const entry = data.result?.result || data.result || data;

        if (!entry) {
          addLog(taskId, 'Пустой ответ от API');
          return;
        }

        if (entry.status_percentage !== undefined) {
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, progress: entry.status_percentage } : t))
          );
          if (entry.status_percentage > 0) {
            addLog(taskId, `Прогресс: ${entry.status_percentage}%`);
          }
        }

        const status = Number(entry.status);

        if (status === 2) {
          let imageUrl = entry.generate_result || entry.media_url || '';
          const thumbnailUrl = entry.thumbnail_small || '';

          if (!imageUrl) {
            const jsonStr = JSON.stringify(data);
            const match = jsonStr.match(/(https?:\/\/[^"]+\.(jpg|jpeg|png|webp)[^"]*)/);
            if (match) imageUrl = match[1];
          }

          if (imageUrl) {
            addLog(taskId, `✅ Перенос стиля завершен! URL: ${imageUrl}`);
            setTasks((prev) =>
              prev.map((t) =>
                t.id === taskId ? { ...t, status: 'completed', progress: 100, imageUrl, thumbnailUrl } : t
              )
            );
            clearInterval(activePolls.current[taskId]);
            delete activePolls.current[taskId];
          } else {
            throw new Error('Статус 2 (завершено), но URL изображения не найден');
          }
        } else if (status > 2) {
          const errMsg = entry.error_message || `Ошибка генерации, код ${status}`;
          throw new Error(errMsg);
        }
      } catch (err: any) {
        addLog(taskId, `Ошибка: ${err.message}`);
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, status: 'failed', error: err.message } : t))
        );
        clearInterval(activePolls.current[taskId]);
        delete activePolls.current[taskId];
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 4000);
    activePolls.current[taskId] = interval;
  };

  // ---- Run single task ----
  const runSingleTask = async (taskId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, status: 'submitting', error: undefined, progress: 0 } : t
      )
    );

    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    try {
      const uuid = await submitTask({ ...task, status: 'submitting' });
      
      const currentTask = tasks.find((t) => t.id === taskId);
      if (currentTask?.status === 'completed') return;

      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: 'polling', uuid } : t))
      );
      startPolling(taskId, uuid);
    } catch (err: any) {
      addLog(taskId, `Ошибка: ${err.message}`);
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: 'failed', error: err.message } : t))
      );
    }
  };

  const processQueue = async () => {
    if (isProcessingAll) return;
    setIsProcessingAll(true);

    const pendingTasks = tasks.filter(
      (t) => (t.status === 'idle' || t.status === 'failed') && t.referenceFile && t.subjectFile
    );

    for (let i = 0; i < pendingTasks.length; i++) {
      const task = pendingTasks[i];
      await runSingleTask(task.id);

      if (i < pendingTasks.length - 1) {
        // nano-banana-pro rate limit 5rq/min -> 13s delay
        const delayMs = task.model === 'nano-banana-pro' ? 13000 : 2000;
        addLog('system', `Ожидание ${delayMs / 1000} сек перед следующей задачей...`);
        await new Promise((resolve) => {
          queueTimeoutRef.current = setTimeout(resolve, delayMs);
        });
      }
    }

    setIsProcessingAll(false);
  };

  // ---- Download ZIP ----
  const downloadAllAsZip = async () => {
    const completedTasks = tasks.filter((t) => t.status === 'completed' && t.imageUrl);
    if (completedTasks.length === 0) {
      alert('Нет готовых изображений для скачивания!');
      return;
    }

    setIsZipping(true);
    const zip = new JSZip();

    try {
      for (let i = 0; i < completedTasks.length; i++) {
        const task = completedTasks[i];
        const indexStr = String(i + 1).padStart(2, '0');
        const cleanPrompt = task.prompt.slice(0, 40).replace(/[^a-zA-Z0-9А-Яа-яёЁ\s-_]/g, '').trim().replace(/\s+/g, '_');
        const ext = task.outputFormat === 'png' ? 'png' : 'jpg';
        const zipFileName = `${indexStr}_style_transfer_${cleanPrompt || 'image'}.${ext}`;

        setZipProgress(`Скачивание ${i + 1} из ${completedTasks.length}...`);

        const imageUrl = task.imageUrl!;
        const fetchUrl = imageUrl.startsWith('https://api.geminigen.ai')
          ? imageUrl.replace('https://api.geminigen.ai', '/api')
          : imageUrl;
        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error(`Не удалось загрузить изображение #${i + 1}`);
        const blob = await response.blob();
        zip.file(zipFileName, blob);
      }

      setZipProgress('Упаковка архива...');
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `style_transfers_${Date.now()}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 100);
      setZipProgress('');
    } catch (err: any) {
      alert(`Ошибка: ${err.message}`);
    } finally {
      setIsZipping(false);
    }
  };

  const downloadSingleImage = async (taskId: string, imageUrl: string, prompt: string, format: string) => {
    try {
      addLog(taskId, 'Начало скачивания изображения...');
      const fetchUrl = imageUrl.startsWith('https://api.geminigen.ai')
        ? imageUrl.replace('https://api.geminigen.ai', '/api')
        : imageUrl;

      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error('Не удалось загрузить файл с сервера');
      const blob = await response.blob();
      const cleanPrompt = prompt.slice(0, 40).replace(/[^a-zA-Z0-9А-Яа-яёЁ\s-_]/g, '').trim().replace(/\s+/g, '_');
      const ext = format === 'png' ? 'png' : 'jpg';
      const fileName = `style_transfer_${cleanPrompt || 'image'}_${Date.now()}.${ext}`;

      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 100);
      addLog(taskId, 'Изображение успешно скачано!');
    } catch (err: any) {
      addLog(taskId, `Прямое скачивание не удалось (CORS/сеть). Открываем в новой вкладке...`);
      // Fallback: open in new tab so user can right-click and save
      window.open(imageUrl, '_blank');
    }
  };

  // ---- Stats ----
  const activeCount = tasks.filter((t) => t.status === 'submitting' || t.status === 'polling').length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;
  
  // Ready to process means has files and status is idle or failed
  const readyToProcessCount = tasks.filter(
    (t) => (t.status === 'idle' || t.status === 'failed') && t.referenceFile && t.subjectFile
  ).length;

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'idle': return 'Ожидает';
      case 'submitting': return 'Отправка...';
      case 'polling': return 'Обработка';
      case 'completed': return 'Готово';
      case 'failed': return 'Ошибка';
      default: return status;
    }
  };

  return (
    <div>
      {/* GLOBAL DEFAULT SETTINGS */}
      <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <Wand2 size={20} style={{ color: 'var(--accent-pink)' }} />
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Настройки переноса стиля по умолчанию</h2>
          <button
            className="secondary"
            style={{ marginLeft: 'auto', fontSize: '0.8rem', padding: '6px 14px' }}
            onClick={applyGlobalSettings}
            title="Применить эти настройки ко всем ожидающим задачам"
          >
            <Palette size={14} />
            Применить ко всем
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
          {/* Model */}
          <div className="img-field">
            <label>Модель</label>
            <select value={globalModel} onChange={(e) => setGlobalModel(e.target.value as ImageModel)}>
              {IMAGE_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <span className="field-hint">{IMAGE_MODELS.find((m) => m.value === globalModel)?.desc}</span>
          </div>

          {/* Style */}
          <div className="img-field">
            <label>Доп. Стиль (по желанию)</label>
            <select value={globalStyle} onChange={(e) => setGlobalStyle(e.target.value as ImageStyle)}>
              {IMAGE_STYLES.map((s) => (
                <option key={s} value={s}>
                  {s === 'None' ? 'Без доп. стиля (только референс)' : s}
                </option>
              ))}
            </select>
          </div>

          {/* Aspect Ratio */}
          <div className="img-field">
            <label>Соотношение сторон</label>
            <div className="ratio-chips">
              {ASPECT_RATIOS.map((r) => (
                <button
                  key={r.value}
                  className={`ratio-chip ${globalAspectRatio === r.value ? 'active' : ''}`}
                  onClick={() => setGlobalAspectRatio(r.value)}
                  title={r.label}
                >
                  {r.icon} {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div className="img-field">
            <label>Разрешение</label>
            <div className="ratio-chips">
              {RESOLUTIONS.map((r) => (
                <button
                  key={r}
                  className={`ratio-chip ${globalResolution === r ? 'active' : ''}`}
                  onClick={() => setGlobalResolution(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Format */}
          <div className="img-field">
            <label>Формат</label>
            <div className="ratio-chips">
              {OUTPUT_FORMATS.map((f) => (
                <button
                  key={f}
                  className={`ratio-chip ${globalFormat === f ? 'active' : ''}`}
                  onClick={() => setGlobalFormat(f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Mode */}
          <div className="img-field">
            <label>Режим промпта</label>
            <select value={globalPromptMode} onChange={(e) => setGlobalPromptMode(e.target.value as 'structured' | 'simple')}>
              <option value="structured">Детальный ИИ (поза+одежда+фон)</option>
              <option value="simple">Простой (как попросили)</option>
            </select>
          </div>
        </div>
      </section>

      {/* QUEUE CONTROL BAR */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button className="primary" onClick={addEmptyTask} style={{ fontSize: '0.85rem' }}>
          <Plus size={16} />
          Добавить пару картинок
        </button>
        <button
          className="secondary"
          onClick={() => addMultipleEmptyTasks(5)}
          style={{ fontSize: '0.85rem' }}
        >
          <Plus size={14} />
          +5 пар
        </button>

        {tasks.length > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <span>Всего пар: <strong>{tasks.length}</strong></span>
              <span>В процессе: <strong style={{ color: 'var(--accent-purple)' }}>{activeCount}</strong></span>
              <span>Готово: <strong style={{ color: 'var(--success)' }}>{completedCount}</strong></span>
              {failedCount > 0 && (
                <span style={{ color: 'var(--danger)' }}>Ошибки: <strong>{failedCount}</strong></span>
              )}
            </div>

            <button
              className="secondary danger"
              onClick={clearQueue}
              disabled={activeCount > 0 || isZipping}
              style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            >
              <Trash2 size={14} />
              Очистить все
            </button>

            {completedCount > 0 && (
              <button
                className="secondary"
                onClick={downloadAllAsZip}
                disabled={isZipping || activeCount > 0}
                style={{ borderColor: 'var(--accent-blue)', color: '#60a5fa', fontSize: '0.8rem', padding: '6px 12px' }}
              >
                {isZipping ? (
                  <>
                    <Loader2 size={14} className="spin" />
                    ZIP...
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    ZIP ({completedCount})
                  </>
                )}
              </button>
            )}

            <button
              className={`primary ${activeCount > 0 ? 'pulse-glow' : ''}`}
              onClick={processQueue}
              disabled={isProcessingAll || isZipping || readyToProcessCount === 0}
              style={{ fontSize: '0.85rem' }}
            >
              {isProcessingAll ? (
                <>
                  <Loader2 size={16} className="spin" />
                  Обработка...
                </>
              ) : (
                <>
                  <Play size={16} />
                  Стилизовать всё ({readyToProcessCount})
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* ZIP Banner */}
      {isZipping && (
        <div className="zip-banner">
          <Loader2 size={16} className="spin" />
          <span>{zipProgress}</span>
        </div>
      )}

      {/* STYLE TRANSFER CARDS GRID */}
      {tasks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
          <ImageIcon size={48} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
          <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>Нет задач переноса стиля</h3>
          <p style={{ margin: 0 }}>
            Добавьте новую пару, загрузите референс стиля (что скопировать) и фото субъекта (на что применить).
          </p>
        </div>
      ) : (
        <div className="style-transfer-grid">
          {tasks.map((task, index) => {
            const isCompleted = task.status === 'completed' && task.imageUrl;
            const isWorking = task.status === 'submitting' || task.status === 'polling';
            const isEditable = task.status === 'idle' || task.status === 'failed' || task.status === 'completed';

            const canSubmit = task.referenceFile && task.subjectFile && task.prompt.trim();

            return (
              <div
                key={task.id}
                className={`img-task-card glass-panel ${task.status}`}
              >
                {/* Header Row */}
                <div className="img-card-header">
                  <span className="img-card-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className={`status-badge ${task.status}`} style={{ fontSize: '0.65rem', padding: '2px 8px' }}>
                    {task.status === 'polling' && <Loader2 size={10} className="spin" />}
                    {task.status === 'completed' && <CheckCircle2 size={10} />}
                    {task.status === 'failed' && <AlertCircle size={10} />}
                    {getStatusLabel(task.status)}
                  </div>

                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
                    {isCompleted && (
                      <button
                        className="secondary"
                        style={{ padding: '4px 6px' }}
                        onClick={() => downloadSingleImage(task.id, task.imageUrl!, task.prompt, task.outputFormat)}
                        title="Скачать"
                      >
                        <Download size={12} />
                      </button>
                    )}
                    <button className="secondary" style={{ padding: '4px 6px' }} onClick={() => duplicateTask(task.id)} title="Дублировать">
                      <Copy size={12} />
                    </button>
                    {task.status === 'completed' && (
                      <button
                        className="secondary"
                        style={{ padding: '4px 6px' }}
                        onClick={() => {
                          setTasks((prev) =>
                            prev.map((t) =>
                              t.id === task.id
                                ? { ...t, status: 'idle' as const, imageUrl: undefined, thumbnailUrl: undefined, error: undefined, progress: 0 }
                                : t
                            )
                          );
                          addLog(task.id, 'Сброс для повторной стилизации');
                        }}
                        title="Перезапустить"
                      >
                        <RefreshCw size={12} />
                      </button>
                    )}
                    <button
                      className="danger"
                      style={{ padding: '4px 6px' }}
                      onClick={() => removeTask(task.id)}
                      disabled={isWorking}
                      title="Удалить"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* PAIR FILE UPLOAD PANEL */}
                <div className="st-pair-container">
                  {/* Reference Image (Style) */}
                  <div className="st-pair-slot">
                    {task.referencePreviewUrl ? (
                      <>
                        <img src={task.referencePreviewUrl} alt="Style Ref" />
                        {isEditable && (
                          <button className="st-slot-remove" onClick={() => removeRefImage(task.id)} title="Убрать реф">
                            <X size={10} />
                          </button>
                        )}
                        <span className="st-slot-label" style={{ color: 'var(--accent-pink)' }}>Референс (photo_1)</span>
                      </>
                    ) : (
                      <label style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <ImageIcon size={20} className="st-slot-icon" style={{ color: 'var(--accent-pink)' }} />
                        <span className="st-slot-label" style={{ fontSize: '0.58rem' }}>Загрузить референс (photo_1)</span>
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            if (e.target.files?.[0]) handleRefUpload(task.id, e.target.files[0]);
                          }}
                        />
                      </label>
                    )}
                  </div>

                  {/* Transition Arrow */}
                  <div className="st-pair-arrow">
                    <ArrowRight size={16} />
                  </div>

                  {/* Subject Image (Content) */}
                  <div className="st-pair-slot">
                    {task.subjectPreviewUrl ? (
                      <>
                        <img src={task.subjectPreviewUrl} alt="Subject Content" />
                        {isEditable && (
                          <button className="st-slot-remove" onClick={() => removeSubjImage(task.id)} title="Убрать фото">
                            <X size={10} />
                          </button>
                        )}
                        <span className="st-slot-label" style={{ color: 'var(--accent-blue)' }}>Ваше лицо (photo_2)</span>
                      </>
                    ) : (
                      <label style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <ImageIcon size={20} className="st-slot-icon" style={{ color: 'var(--accent-blue)' }} />
                        <span className="st-slot-label" style={{ fontSize: '0.58rem' }}>Загрузить ваше фото (photo_2)</span>
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            if (e.target.files?.[0]) handleSubjUpload(task.id, e.target.files[0]);
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>

                {/* Result Area */}
                <div
                  className="st-result-container"
                  onClick={() => {
                    if (isCompleted) setLightbox({ url: task.imageUrl!, name: task.prompt.slice(0, 60) });
                  }}
                  style={{ cursor: isCompleted ? 'zoom-in' : 'default' }}
                >
                  {isCompleted ? (
                    <>
                      <img src={task.imageUrl} alt={task.prompt} className="st-result-image" />
                      <button
                        className="st-result-download-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadSingleImage(task.id, task.imageUrl!, task.prompt, task.outputFormat);
                        }}
                        title="Скачать изображение"
                      >
                        <Download size={14} /> Скачать
                      </button>
                    </>
                  ) : isWorking ? (
                    <div className="st-result-loading">
                      <Loader2 size={32} className="spin" style={{ color: 'var(--accent-purple)' }} />
                      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{task.progress}%</span>
                    </div>
                  ) : task.status === 'failed' ? (
                    <div className="st-result-error">
                      <AlertCircle size={28} style={{ color: 'var(--danger)' }} />
                      <span style={{ fontSize: '0.7rem', color: 'var(--danger)', textAlign: 'center', padding: '0 8px' }}>
                        {task.error?.slice(0, 80)}
                      </span>
                    </div>
                  ) : (
                    <div className="st-result-empty">
                      <Wand2 size={24} style={{ opacity: 0.15 }} />
                      <span>Результат</span>
                    </div>
                  )}

                  {/* Zoom overlay on completed */}
                  {isCompleted && (
                    <div className="st-result-zoom-overlay">
                      <Maximize2 size={20} />
                    </div>
                  )}
                </div>

                {/* Prompt */}
                <textarea
                  rows={2}
                  value={task.prompt}
                  onChange={(e) => updateTaskField(task.id, 'prompt', e.target.value)}
                  disabled={!isEditable}
                  placeholder="Например: сделай мне photo_2 точно такую же фотографию как на фото photo_1"
                  className="img-card-prompt"
                />

                {/* Settings Row */}
                <div className="img-card-settings">
                  <select
                    value={task.model}
                    onChange={(e) => updateTaskField(task.id, 'model', e.target.value)}
                    disabled={!isEditable}
                    className="img-card-select"
                  >
                    {IMAGE_MODELS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>

                  <select
                    value={task.style}
                    onChange={(e) => updateTaskField(task.id, 'style', e.target.value)}
                    disabled={!isEditable}
                    className="img-card-select"
                  >
                    {IMAGE_STYLES.map((s) => (
                      <option key={s} value={s}>{s === 'None' ? 'Без доп. стиля' : s}</option>
                    ))}
                  </select>

                  <select
                    value={task.aspectRatio}
                    onChange={(e) => updateTaskField(task.id, 'aspectRatio', e.target.value)}
                    disabled={!isEditable}
                    className="img-card-select"
                  >
                    {ASPECT_RATIOS.map((r) => (
                      <option key={r.value} value={r.value}>{r.icon} {r.label}</option>
                    ))}
                  </select>

                  <select
                    value={task.promptMode || 'structured'}
                    onChange={(e) => updateTaskField(task.id, 'promptMode', e.target.value)}
                    disabled={!isEditable}
                    className="img-card-select"
                  >
                    <option value="structured">Детальный ИИ</option>
                    <option value="simple">Простой промпт</option>
                  </select>
                </div>

                {/* Action Buttons */}
                <div className="img-card-actions" style={{ marginTop: '4px' }}>
                  {isEditable && (
                    <button
                      className="primary"
                      onClick={() => runSingleTask(task.id)}
                      disabled={!canSubmit || isZipping}
                      style={{ width: '100%', fontSize: '0.8rem', padding: '8px' }}
                    >
                      <Sparkles size={14} />
                      Стилизовать
                    </button>
                  )}
                  {task.status === 'failed' && (
                    <button
                      className="primary"
                      onClick={() => runSingleTask(task.id)}
                      style={{ width: '100%', fontSize: '0.8rem', padding: '8px' }}
                    >
                      <RefreshCw size={14} />
                      Повторить
                    </button>
                  )}
                </div>

                {/* Logs */}
                {taskLogs[task.id] && taskLogs[task.id].length > 0 && (
                  <details className="img-card-logs" style={{ marginTop: '4px' }}>
                    <summary>Логи ({taskLogs[task.id].length})</summary>
                    <div className="img-card-logs-content">
                      {taskLogs[task.id].map((log, idx) => (
                        <div key={idx}>{log}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* LIGHTBOX */}
      {lightbox && (
        <div
          className="img-lightbox"
          onClick={() => setLightbox(null)}
          onKeyDown={(e) => e.key === 'Escape' && setLightbox(null)}
          tabIndex={0}
          ref={(el) => el?.focus()}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh', cursor: 'default' }}>
            <img
              src={lightbox.url}
              alt={lightbox.name}
              style={{
                maxWidth: '90vw',
                maxHeight: '85vh',
                borderRadius: '12px',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                objectFit: 'contain',
              }}
            />
            <div style={{ textAlign: 'center', marginTop: '12px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              {lightbox.name}
            </div>
            <button
              onClick={() => setLightbox(null)}
              style={{
                position: 'absolute',
                top: '-12px',
                right: '-12px',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(255,255,255,0.15)',
                color: '#fff',
                fontSize: '1.2rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backdropFilter: 'blur(4px)',
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
