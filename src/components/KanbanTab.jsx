import React, { useState } from 'react';

export const KanbanTab = React.memo(function KanbanTab({ tasks, currentRepo, onTasksChanged }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const mutate = async (url, method, body) => {
    setBusy(true); setError('');
    try {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Task update failed');
      await onTasksChanged(); return true;
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to connect'); return false; }
    finally { setBusy(false); }
  };
  const todoTasks = tasks.filter((t) => t.status === 'todo');
  const inProgressTasks = tasks.filter((t) => t.status === 'in_progress');
  const doneTasks = tasks.filter((t) => t.status === 'done');

  const columns = [
    { key: 'todo', title: 'To Do', items: todoTasks },
    { key: 'in_progress', title: 'In Progress', items: inProgressTasks },
    { key: 'done', title: 'Done', items: doneTasks },
  ];

  return (
    <section className="space-y-6">
      <form className="flex gap-3" onSubmit={async event => {
        event.preventDefault();
        if (currentRepo && await mutate(`/api/v1/repositories/${currentRepo.forgejo_repo_id}/tasks`, 'POST', { title })) setTitle('');
      }}>
        <label className="flex-1">New workspace task<input required maxLength={240} value={title} onChange={event => setTitle(event.target.value)} className="block w-full mt-1 rounded bg-slate-900 border border-slate-600 p-2" /></label>
        <button disabled={busy || !currentRepo} className="self-end rounded bg-amber-400 text-slate-950 px-4 py-2 disabled:opacity-50">Add task</button>
      </form>
      {error && <p role="alert" className="text-red-300">{error}</p>}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {columns.map((col) => (
          <div key={col.key} className="bg-[#0b132b] border border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="text-sm font-semibold capitalize font-mono text-slate-100">{col.title}</h3>
              <span className="text-xs font-mono text-slate-500 tabular-nums">{col.items.length}</span>
            </div>
            {col.items.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">No tasks</div>
            ) : (
              col.items.map((task) => (
                <div key={task.id} className="p-3 bg-slate-900 border border-slate-800 rounded space-y-1.5">
                  <div className="text-xs font-semibold text-slate-200">{task.title}</div>
                  <div className="text-[11px] font-mono text-amber-300/90">{task.markdown_file_path}</div>
                  <label className="block text-xs text-slate-400">Status
                    <select disabled={busy} value={task.status} onChange={event => mutate(`/api/v1/tasks/${task.id}/status`, 'PATCH', { status: event.target.value })} className="block mt-1 rounded bg-slate-950 border border-slate-700 p-2 text-slate-200">
                      <option value="todo">To Do</option><option value="in_progress">In Progress</option><option value="done">Done</option>
                    </select>
                  </label>
                  {task.commits && task.commits.length > 0 && (
                    <div className="pt-1.5 border-t border-slate-800/80 text-[10px] font-mono text-slate-400">
                      Linked: {task.commits[0].commit_sha.slice(0, 8)} ({task.commits[0].action_type})
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        ))}
      </div>
    </section>
  );
});

