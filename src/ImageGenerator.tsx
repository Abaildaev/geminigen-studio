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
} from 'lucide-react';
import JSZip from 'jszip';
import type {
  ImageGenTask,
  ImageModel,
  ImageAspectRatio,
  ImageStyle,
  ImageOutputFormat,
  ImageResolution,
} from './types';



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

export default function ImageGenerator({ apiKey }: Props) {
  // Tasks Queue
  const [tasks, setTasks] = useState<ImageGenTask[]>([]);

  // Global defaults
  const [globalModel] = useState<ImageModel>('nano-banana-pro');
  const [globalAspectRatio, setGlobalAspectRatio] = useState<ImageAspectRatio>('1:1');
  const [globalResolution, setGlobalResolution] = useState<ImageResolution>('1K');
  const [globalFormat, setGlobalFormat] = useState<ImageOutputFormat>('png');

  // Batch prompts textarea
  const [batchPrompts, setBatchPrompts] = useState('');

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
    const id = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newTask: ImageGenTask = {
      id,
      prompt: '',
      model: globalModel,
      aspectRatio: globalAspectRatio,
      style: 'Photorealistic',
      outputFormat: globalFormat,
      resolution: globalResolution,
      status: 'idle',
      progress: 0,
    };
    setTasks((prev) => [...prev, newTask]);
    addLog(id, 'Создана новая задача генерации изображения');
  };

  const addMultipleEmptyTasks = (count: number) => {
    const newTasks: ImageGenTask[] = Array.from({ length: count }, (_, i) => {
      const id = `img-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`;
      return {
        id,
        prompt: '',
        model: globalModel,
        aspectRatio: globalAspectRatio,
        style: 'Photorealistic' as ImageStyle,
        outputFormat: globalFormat,
        resolution: globalResolution,
        status: 'idle' as const,
        progress: 0,
      };
    });
    setTasks((prev) => [...prev, ...newTasks]);
    newTasks.forEach((t) => addLog(t.id, 'Создана новая задача генерации изображения'));
  };

  const duplicateTask = (id: string) => {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const newId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const copy: ImageGenTask = {
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

  const updateTaskField = (id: string, field: keyof ImageGenTask, value: any) => {
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
    });
    setTasks([]);
    setTaskLogs({});
    setIsProcessingAll(false);
  };

  // ---- Reference Image Upload for a single task ----
  const handleRefUpload = (taskId: string, file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, referenceFile: file, referencePreviewUrl: previewUrl, referenceFileName: file.name }
          : t
      )
    );
    addLog(taskId, `Загружено реф-изображение: ${file.name}`);
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

  // ---- Batch Prompts ----
  const applyBatchPrompts = () => {
    const blocks = batchPrompts
      .split(/\n\s*\n/)
      .map((block) => {
        const cleaned = block
          .split('\n')
          .filter((line) => !/^\s*(сцена|scene|кадр|frame|#|изображение|image)?\s*\d+\s*$/i.test(line.trim()))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        return cleaned;
      })
      .filter((b) => b.length > 0);

    if (blocks.length === 0) return;

    // If we have more prompts than tasks — auto-create tasks
    if (blocks.length > tasks.length) {
      const diff = blocks.length - tasks.length;
      addMultipleEmptyTasks(diff);
    }

    // Apply prompts (with a slight delay so newly added tasks are in state)
    setTimeout(() => {
      setTasks((prev) =>
        prev.map((t, idx) => {
          if (idx < blocks.length && (t.status === 'idle' || t.status === 'failed')) {
            return { ...t, prompt: blocks[idx] };
          }
          return t;
        })
      );
    }, 50);

    const applied = Math.min(blocks.length, Math.max(tasks.length, blocks.length));
    alert(`✅ Промты распределены: ${applied} задач(и).`);
  };

  // Apply global settings to all idle tasks
  const applyGlobalSettings = () => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.status === 'idle' || t.status === 'failed') {
          return {
            ...t,
            model: globalModel,
            aspectRatio: globalAspectRatio,
            resolution: globalResolution,
            outputFormat: globalFormat,
          };
        }
        return t;
      })
    );
  };

  // ---- API Submission ----
  const submitTask = async (task: ImageGenTask): Promise<string> => {
    if (!apiKey) throw new Error('API ключ не задан');
    if (!task.prompt.trim()) throw new Error('Промпт не может быть пустым');

    addLog(task.id, `Подготовка запроса через модель ${task.model}...`);

    const formData = new FormData();
    formData.append('prompt', task.prompt);
    formData.append('aspect_ratio', task.aspectRatio);
    formData.append('resolution', task.resolution || '1K');
    formData.append('model', task.model);
    formData.append('style', task.style);
    formData.append('output_format', task.outputFormat);

    if (task.referenceFile) {
      formData.append('files', task.referenceFile, task.referenceFileName || 'reference.jpg');
      addLog(task.id, `Прикреплено реф-изображение: ${task.referenceFileName}`);
    }

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

    // Check if already completed immediately
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
  const startPolling = (taskId: string, uuid: string, _model: string) => {
    if (activePolls.current[taskId]) {
      clearInterval(activePolls.current[taskId]);
    }

    addLog(taskId, `Опрос статуса каждые 4 сек для UUID: ${uuid}`);
    const checkStatus = async () => {
      try {
        const historyUrl = `/api/uapi/v1/history/${uuid}`;
        const response = await fetch(historyUrl, {
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
            addLog(taskId, `✅ Генерация завершена! URL: ${imageUrl}`);
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
          const errMsg = entry.error_message || `Генерация ошибка, код ${status}`;
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

  // ---- Run tasks ----
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
      // If already completed (instant), skip polling
      const currentTask = tasks.find((t) => t.id === taskId);
      if (currentTask?.status === 'completed') return;

      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: 'polling', uuid } : t))
      );
      startPolling(taskId, uuid, task.model);
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

    const pendingTasks = tasks.filter((t) => (t.status === 'idle' || t.status === 'failed') && t.prompt.trim());

    for (let i = 0; i < pendingTasks.length; i++) {
      const task = pendingTasks[i];
      await runSingleTask(task.id);

      if (i < pendingTasks.length - 1) {
        // nano-banana-pro has rate limit 5rq/min
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
        const zipFileName = `${indexStr}_${cleanPrompt || 'image'}.${ext}`;

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
      link.download = `generated_images_${Date.now()}.zip`;
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
      const fileName = `generated_image_${cleanPrompt || 'image'}_${Date.now()}.${ext}`;

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
  const idleWithPrompt = tasks.filter((t) => (t.status === 'idle' || t.status === 'failed') && t.prompt.trim()).length;

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'idle': return 'Ожидает';
      case 'submitting': return 'Отправка...';
      case 'polling': return 'Генерируется';
      case 'completed': return 'Готово';
      case 'failed': return 'Ошибка';
      default: return status;
    }
  };

  return (
    <div>
      {/* GLOBAL SETTINGS PANEL */}
      <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <div className="panel-header" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <Wand2 size={20} style={{ color: 'var(--accent-pink)' }} />
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Настройки генерации по умолчанию</h2>
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
          {/* Aspect Ratio */}
          <div className="img-field">
            <label>Соотношение сторон</label>
            <div className="ratio-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {ASPECT_RATIOS.map((r) => (
                <button
                  key={r.value}
                  className={`ratio-chip ${globalAspectRatio === r.value ? 'active' : ''}`}
                  onClick={() => setGlobalAspectRatio(r.value)}
                  title={r.label}
                  style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                >
                  {r.icon} {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Resolution */}
          <div className="img-field">
            <label>Разрешение</label>
            <div className="ratio-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {RESOLUTIONS.map((r) => (
                <button
                  key={r}
                  className={`ratio-chip ${globalResolution === r ? 'active' : ''}`}
                  onClick={() => setGlobalResolution(r)}
                  style={{ padding: '4px 8px', fontSize: '0.8rem' }}
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
        </div>
      </section>

      {/* BATCH PROMPTS */}
      <section className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <span style={{ fontSize: '1.2rem' }}>📋</span>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Пакетные промты</h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            — каждый абзац = отдельное изображение. Задачи создаются автоматически.
          </span>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <textarea
            rows={6}
            value={batchPrompts}
            onChange={(e) => setBatchPrompts(e.target.value)}
            placeholder={`Мощный волк стоит на вершине горы, лунный свет, фотореалистично\n\nФутуристический город будущего, неоновые огни, дождь, киберпанк\n\nДракон летит над облаками на закате, масштабный epic-shot\n\nУютная кофейня в осеннем Париже, тёплый свет, акварельный стиль`}
            style={{ width: '100%', resize: 'vertical', fontSize: '0.85rem', lineHeight: '1.6' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
            <button
              className="primary"
              style={{ whiteSpace: 'nowrap', padding: '10px 18px', fontSize: '0.85rem' }}
              onClick={applyBatchPrompts}
              disabled={!batchPrompts.trim()}
            >
              <Sparkles size={14} />
              Распределить
            </button>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center' }}>
              {batchPrompts.trim()
                ? `${batchPrompts.split(/\n\s*\n/).filter((b) => b.trim()).length} изображ.`
                : ''}
            </span>
          </div>
        </div>
      </section>

      {/* ADD TASKS CONTROLS */}
      <div className="controls-bar" style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button className="primary" onClick={addEmptyTask} style={{ fontSize: '0.85rem' }}>
          <Plus size={16} />
          Добавить задачу
        </button>
        <button
          className="secondary"
          onClick={() => addMultipleEmptyTasks(5)}
          style={{ fontSize: '0.85rem' }}
        >
          <Plus size={14} />
          +5 задач
        </button>
        <button
          className="secondary"
          onClick={() => addMultipleEmptyTasks(10)}
          style={{ fontSize: '0.85rem' }}
        >
          <Plus size={14} />
          +10 задач
        </button>

        {tasks.length > 0 && (
          <div className="controls-group-right" style={{ marginLeft: 'auto', display: 'flex', gap: '12px', alignItems: 'center' }}>
            <div className="stats-group" style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <span>Всего: <strong>{tasks.length}</strong></span>
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
              Очистить
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
              disabled={isProcessingAll || isZipping || idleWithPrompt === 0}
              style={{ fontSize: '0.85rem' }}
            >
              {isProcessingAll ? (
                <>
                  <Loader2 size={16} className="spin" />
                  Генерация...
                </>
              ) : (
                <>
                  <Play size={16} />
                  Генерировать всё ({idleWithPrompt})
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* ZIP Progress */}
      {isZipping && (
        <div className="zip-banner">
          <Loader2 size={16} className="spin" />
          <span>{zipProgress}</span>
        </div>
      )}

      {/* TASK CARDS GRID */}
      {tasks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
          <ImageIcon size={48} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
          <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>Нет задач</h3>
          <p style={{ margin: 0 }}>
            Добавьте задачи вручную или вставьте промты в поле «Пакетные промты» выше.
          </p>
        </div>
      ) : (
        <div className="img-tasks-grid">
          {tasks.map((task, index) => {
            const isCompleted = task.status === 'completed' && task.imageUrl;
            const isWorking = task.status === 'submitting' || task.status === 'polling';
            const isEditable = task.status === 'idle' || task.status === 'failed' || task.status === 'completed';

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
                          addLog(task.id, 'Сброс для перегенерации');
                        }}
                        title="Перегенерировать"
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

                {/* Image Preview / Result */}
                <div
                  className="img-card-preview"
                  onClick={() => {
                    if (isCompleted) setLightbox({ url: task.imageUrl!, name: task.prompt.slice(0, 60) });
                  }}
                  style={{ cursor: isCompleted ? 'zoom-in' : 'default' }}
                >
                  {isCompleted ? (
                    <>
                      <img src={task.imageUrl} alt={task.prompt} className="img-card-result" />
                      <button
                        className="img-card-download-btn"
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
                    <div className="img-card-loading">
                      <Loader2 size={32} className="spin" style={{ color: 'var(--accent-purple)' }} />
                      <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{task.progress}%</span>
                    </div>
                  ) : task.status === 'failed' ? (
                    <div className="img-card-error">
                      <AlertCircle size={28} style={{ color: 'var(--danger)' }} />
                      <span style={{ fontSize: '0.7rem', color: 'var(--danger)', textAlign: 'center', padding: '0 8px' }}>
                        {task.error?.slice(0, 80)}
                      </span>
                    </div>
                  ) : (
                    <div className="img-card-empty">
                      <ImageIcon size={28} style={{ opacity: 0.2 }} />
                    </div>
                  )}

                  {/* Zoom overlay on completed */}
                  {isCompleted && (
                    <div className="img-card-zoom-overlay">
                      <Maximize2 size={20} />
                    </div>
                  )}
                </div>

                {/* Prompt */}
                <textarea
                  rows={3}
                  value={task.prompt}
                  onChange={(e) => updateTaskField(task.id, 'prompt', e.target.value)}
                  disabled={!isEditable}
                  placeholder="Опишите изображение..."
                  className="img-card-prompt"
                />

                 {/* Compact settings row */}
                <div className="img-card-settings" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '6px' }}>
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
                    value={task.resolution}
                    onChange={(e) => updateTaskField(task.id, 'resolution', e.target.value as any)}
                    disabled={!isEditable}
                    className="img-card-select"
                  >
                    {RESOLUTIONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>

                  <select
                    value={task.outputFormat}
                    onChange={(e) => updateTaskField(task.id, 'outputFormat', e.target.value)}
                    disabled={!isEditable}
                    className="img-card-select"
                  >
                    {OUTPUT_FORMATS.map((f) => (
                      <option key={f} value={f}>{f.toUpperCase()}</option>
                    ))}
                  </select>
                </div>

                {/* Reference image */}
                <div className="img-card-ref">
                  {task.referencePreviewUrl ? (
                    <div className="img-ref-preview">
                      <img src={task.referencePreviewUrl} alt="ref" />
                      <span className="img-ref-name">{task.referenceFileName}</span>
                      {isEditable && (
                        <button className="img-ref-remove" onClick={() => removeRefImage(task.id)} title="Убрать реф">
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  ) : isEditable ? (
                    <label className="img-ref-upload">
                      <ImageIcon size={12} />
                      <span>Реф-изображение</span>
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          if (e.target.files?.[0]) handleRefUpload(task.id, e.target.files[0]);
                        }}
                      />
                    </label>
                  ) : null}
                </div>

                {/* Action Buttons */}
                <div className="img-card-actions">
                  {isEditable && (
                    <button
                      className="primary"
                      onClick={() => runSingleTask(task.id)}
                      disabled={!task.prompt.trim() || isZipping}
                      style={{ width: '100%', fontSize: '0.8rem', padding: '8px' }}
                    >
                      <Sparkles size={14} />
                      Сгенерировать
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
                  <details className="img-card-logs">
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
