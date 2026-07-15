using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace LeaveSystemLauncher
{
    public class MainForm : Form
    {
        // ---------------------------------------------------------------
        // Configuration — adjust here if the deployment ever changes port.
        // Matches backend/.env (PORT=3001).
        // ---------------------------------------------------------------
        private const int Port = 3001;
        private static readonly string RootDir = AppContext.BaseDirectory;
        private static readonly string BackendDir = Path.Combine(RootDir, "backend");
        private static readonly string FrontendDistDir = Path.Combine(RootDir, "frontend", "dist");
        private static readonly string LogFile = Path.Combine(RootDir, "launcher.log");
        private static readonly string ServerUrl = "http://localhost:" + Port;

        // ---------------------------------------------------------------
        // State
        // ---------------------------------------------------------------
        private Process _serverProcess;
        private readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(1.5) };
        private readonly Timer _statusTimer = new Timer { Interval = 2000 };
        private readonly object _logLock = new object();
        private bool _isRunning;
        private bool _busy;

        // ---------------------------------------------------------------
        // Controls
        // ---------------------------------------------------------------
        private Label _titleLabel;
        private Label _subtitleLabel;
        private Panel _statusDot;
        private Label _statusLabel;
        private Button _startButton;
        private Button _stopButton;
        private Button _browserButton;
        private Label _footerLabel;

        // Theme colors matching the web app's own dark/emerald branding.
        private static readonly Color ColBg = ColorTranslator.FromHtml("#0b0f19");
        private static readonly Color ColPanel = ColorTranslator.FromHtml("#131a2a");
        private static readonly Color ColEmerald = ColorTranslator.FromHtml("#10b981");
        private static readonly Color ColBlue = ColorTranslator.FromHtml("#60a5fa");
        private static readonly Color ColDanger = ColorTranslator.FromHtml("#ef4444");
        private static readonly Color ColTextMain = ColorTranslator.FromHtml("#f3f4f6");
        private static readonly Color ColTextMuted = ColorTranslator.FromHtml("#9ca3af");

        public MainForm()
        {
            BuildUI();
            _statusTimer.Tick += StatusTimer_Tick;
            _statusTimer.Start();
            UpdateStatus(false);
        }

        // =================================================================
        // UI construction
        // =================================================================
        private void BuildUI()
        {
            Text = "مشغل منظومة الإجازات - القره بوللي";
            RightToLeft = RightToLeft.Yes;
            RightToLeftLayout = true;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = true;
            ClientSize = new Size(420, 380);
            BackColor = ColBg;
            Font = new Font("Segoe UI", 10F);

            _titleLabel = new Label
            {
                Text = "منظومة إجازات الموظفين الرقمية",
                ForeColor = ColEmerald,
                Font = new Font("Segoe UI", 14F, FontStyle.Bold),
                TextAlign = ContentAlignment.MiddleCenter,
                Location = new Point(10, 20),
                Size = new Size(400, 32),
            };

            _subtitleLabel = new Label
            {
                Text = "مكتب أوقاف القره بوللي",
                ForeColor = ColTextMuted,
                Font = new Font("Segoe UI", 9.5F),
                TextAlign = ContentAlignment.MiddleCenter,
                Location = new Point(10, 54),
                Size = new Size(400, 22),
            };

            var statusPanel = new Panel
            {
                BackColor = ColPanel,
                Location = new Point(30, 95),
                Size = new Size(360, 56),
            };

            _statusDot = new Panel
            {
                BackColor = ColPanel,
                Size = new Size(16, 16),
                Location = new Point(20, 20),
            };
            _statusDot.Paint += StatusDot_Paint;

            _statusLabel = new Label
            {
                Text = "الحالة: متوقف",
                ForeColor = ColTextMain,
                Font = new Font("Segoe UI", 11.5F, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(45, 17),
            };

            statusPanel.Controls.Add(_statusDot);
            statusPanel.Controls.Add(_statusLabel);

            _startButton = MakeButton("تشغيل النظام", ColEmerald, new Point(30, 170));
            _startButton.Click += async (s, e) => await StartServerAsync();

            _stopButton = MakeButton("إيقاف النظام", ColDanger, new Point(30, 220));
            _stopButton.Enabled = false;
            _stopButton.Click += (s, e) => StopServer(true);

            _browserButton = MakeButton("فتح في المتصفح", ColBlue, new Point(30, 270));
            _browserButton.Enabled = false;
            _browserButton.Click += (s, e) => OpenBrowser();

            _footerLabel = new Label
            {
                Text = "المنفذ: " + Port,
                ForeColor = ColTextMuted,
                Font = new Font("Segoe UI", 8.5F),
                TextAlign = ContentAlignment.MiddleCenter,
                Location = new Point(10, 340),
                Size = new Size(400, 24),
            };

            Controls.Add(_titleLabel);
            Controls.Add(_subtitleLabel);
            Controls.Add(statusPanel);
            Controls.Add(_startButton);
            Controls.Add(_stopButton);
            Controls.Add(_browserButton);
            Controls.Add(_footerLabel);
        }

        private Button MakeButton(string text, Color backColor, Point location)
        {
            var btn = new Button
            {
                Text = text,
                BackColor = backColor,
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 10.5F, FontStyle.Bold),
                Size = new Size(360, 40),
                Location = location,
                Cursor = Cursors.Hand,
            };
            btn.FlatAppearance.BorderSize = 0;
            return btn;
        }

        private void StatusDot_Paint(object sender, PaintEventArgs e)
        {
            using (var brush = new SolidBrush(_isRunning ? ColEmerald : ColDanger))
            {
                e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                e.Graphics.FillEllipse(brush, 0, 0, _statusDot.Width, _statusDot.Height);
            }
        }

        // =================================================================
        // Server lifecycle
        // =================================================================
        private async Task StartServerAsync()
        {
            if (_busy) return;
            _busy = true;
            _startButton.Enabled = false;
            _statusLabel.Text = "الحالة: جاري التحقق...";

            try
            {
                if (await IsServerHealthyAsync())
                {
                    MessageBox.Show(this, "النظام يعمل بالفعل.", "تنبيه",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                    UpdateStatus(true);
                    return;
                }

                if (!IsNodeInstalled())
                {
                    MessageBox.Show(this,
                        "لم يتم العثور على Node.js على هذا الجهاز.\n\n" +
                        "يرجى تثبيت Node.js من الموقع الرسمي:\nhttps://nodejs.org\n\n" +
                        "ثم إعادة تشغيل هذا البرنامج.",
                        "خطأ - Node.js غير مثبت", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    UpdateStatus(false);
                    return;
                }

                if (!Directory.Exists(Path.Combine(BackendDir, "node_modules")) || !Directory.Exists(FrontendDistDir))
                {
                    MessageBox.Show(this,
                        "يبدو أن هذا أول تشغيل للنظام على هذا الجهاز.\n\n" +
                        "يرجى تشغيل الملف \"start.bat\" مرة واحدة أولاً لتثبيت المتطلبات وبناء الواجهة،\n" +
                        "ثم استخدم هذا المشغل بعد ذلك.",
                        "الإعداد الأولي مطلوب", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    UpdateStatus(false);
                    return;
                }

                _statusLabel.Text = "الحالة: جاري التشغيل...";

                var psi = new ProcessStartInfo
                {
                    FileName = "node",
                    Arguments = "src/server.js",
                    WorkingDirectory = BackendDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                psi.EnvironmentVariables["NODE_ENV"] = "production";

                _serverProcess = new Process { StartInfo = psi, EnableRaisingEvents = true };
                _serverProcess.OutputDataReceived += (s, e) => LogLine(e.Data);
                _serverProcess.ErrorDataReceived += (s, e) => LogLine(e.Data);
                _serverProcess.Exited += ServerProcess_Exited;

                _serverProcess.Start();
                _serverProcess.BeginOutputReadLine();
                _serverProcess.BeginErrorReadLine();

                // Give Node a moment to bind the port, then confirm via HTTP
                // rather than assuming success just because the process started.
                bool healthy = false;
                for (int i = 0; i < 20 && !healthy; i++)
                {
                    await Task.Delay(300);
                    healthy = await IsServerHealthyAsync();
                }

                if (!healthy)
                {
                    MessageBox.Show(this,
                        "تم تشغيل العملية لكن الخادم لم يستجب خلال المهلة المتوقعة.\n" +
                        "راجع ملف launcher.log بجانب البرنامج لمزيد من التفاصيل.",
                        "تحذير", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                UpdateStatus(healthy);
            }
            catch (Exception ex)
            {
                LogLine("[launcher] فشل التشغيل: " + ex.Message);
                MessageBox.Show(this, "تعذر تشغيل الخادم:\n" + ex.Message, "خطأ",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                UpdateStatus(false);
            }
            finally
            {
                _busy = false;
            }
        }

        private void ServerProcess_Exited(object sender, EventArgs e)
        {
            if (IsDisposed) return;
            try
            {
                BeginInvoke(new Action(() =>
                {
                    if (!_busy) UpdateStatus(false);
                }));
            }
            catch
            {
                // form is closing; nothing to update
            }
        }

        private void StopServer(bool showConfirmation)
        {
            bool hadProcess = _serverProcess != null;
            try
            {
                if (_serverProcess != null && !_serverProcess.HasExited)
                {
                    KillProcessTree(_serverProcess.Id);
                    _serverProcess.WaitForExit(3000);
                }
            }
            catch
            {
                // already gone — nothing to do
            }
            finally
            {
                if (_serverProcess != null)
                {
                    try { _serverProcess.Dispose(); } catch { }
                    _serverProcess = null;
                }
                UpdateStatus(false);
            }

            if (showConfirmation && hadProcess)
            {
                LogLine("[launcher] تم إيقاف الخادم بواسطة المستخدم.");
            }
        }

        private static void KillProcessTree(int pid)
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "taskkill",
                    Arguments = "/PID " + pid + " /T /F",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                };
                using (var p = Process.Start(psi))
                {
                    p.WaitForExit(3000);
                }
            }
            catch
            {
                // best effort — if this fails the WaitForExit above will time out safely
            }
        }

        private void OpenBrowser()
        {
            try
            {
                Process.Start(new ProcessStartInfo(ServerUrl) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "تعذر فتح المتصفح:\n" + ex.Message, "خطأ",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        // =================================================================
        // Status polling
        // =================================================================
        private async void StatusTimer_Tick(object sender, EventArgs e)
        {
            if (_busy) return;
            bool healthy = await IsServerHealthyAsync();
            UpdateStatus(healthy);
        }

        private async Task<bool> IsServerHealthyAsync()
        {
            try
            {
                var resp = await _http.GetAsync(ServerUrl + "/api/health");
                return resp.IsSuccessStatusCode;
            }
            catch
            {
                return false;
            }
        }

        private void UpdateStatus(bool running)
        {
            _isRunning = running;
            _statusLabel.Text = running ? "الحالة: يعمل" : "الحالة: متوقف";
            _statusDot.Invalidate();
            _stopButton.Enabled = running;
            _browserButton.Enabled = running;
            _startButton.Enabled = !running;
        }

        // =================================================================
        // Pre-flight checks & logging
        // =================================================================
        private static bool IsNodeInstalled()
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "where",
                    Arguments = "node",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                using (var p = Process.Start(psi))
                {
                    p.WaitForExit(3000);
                    return p.ExitCode == 0;
                }
            }
            catch
            {
                return false;
            }
        }

        private void LogLine(string line)
        {
            if (string.IsNullOrEmpty(line)) return;
            try
            {
                lock (_logLock)
                {
                    File.AppendAllText(LogFile,
                        "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + line + Environment.NewLine);
                }
            }
            catch
            {
                // best-effort diagnostic logging only
            }
        }

        // =================================================================
        // Auto-close: never leave node.exe running after the launcher exits.
        // =================================================================
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            _statusTimer.Stop();
            StopServer(false);
            base.OnFormClosing(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _statusTimer.Dispose();
                _http.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}
