using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Net.Sockets;
using System.Windows.Forms;

namespace PhasePanel;

internal static class Program
{
    private static readonly string DataDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PhasePanel");

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        using var instance = new Mutex(true, @"Local\PhasePanel", out bool firstInstance);
        if (!firstInstance)
        {
            OpenExisting();
            return;
        }

        try
        {
            Application.Run(new LauncherContext(DataDirectory));
        }
        finally
        {
            instance.ReleaseMutex();
        }
    }

    private static void OpenExisting()
    {
        try
        {
            string port = File.ReadAllText(Path.Combine(DataDirectory, "port.txt")).Trim();
            if (!int.TryParse(port, out int number) || number is < 1 or > 65535)
                throw new InvalidDataException();
            Process.Start(new ProcessStartInfo($"http://127.0.0.1:{number}/") { UseShellExecute = true });
        }
        catch
        {
            MessageBox.Show("PhasePanel is starting. Open it from the notification area in a moment.",
                "PhasePanel", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }
}

internal sealed class LauncherContext : ApplicationContext
{
    private readonly string dataDirectory;
    private readonly string sessionFile;
    private readonly NotifyIcon tray;
    private readonly System.Windows.Forms.Timer timer;
    private readonly HttpClient client = new();
    private Process? server;
    private StreamWriter? log;
    private string? dashboardUrl;
    private int port;
    private bool fixedPort;
    private int attempts;
    private bool ready;
    private bool closing;

    public LauncherContext(string dataDirectory)
    {
        this.dataDirectory = dataDirectory;
        sessionFile = Path.Combine(dataDirectory, "port.txt");
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open Dashboard", null, (_, _) => OpenDashboard());
        menu.Items.Add("Quit PhasePanel", null, (_, _) => ExitThread());
        tray = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application,
            Text = "PhasePanel",
            ContextMenuStrip = menu,
            Visible = true,
        };
        tray.DoubleClick += (_, _) => OpenDashboard();
        timer = new System.Windows.Forms.Timer { Interval = 250 };
        timer.Tick += CheckServer;
        try
        {
            StartServer();
            timer.Start();
        }
        catch (Exception error)
        {
            Fail($"Could not start PhasePanel: {error.Message}");
        }
    }

    private void StartServer()
    {
        Directory.CreateDirectory(dataDirectory);
        string dataPathFile = Path.Combine(dataDirectory, "data-directory.txt");
        if (!File.Exists(dataPathFile)) File.WriteAllText(dataPathFile, dataDirectory + Environment.NewLine);
        string configuredDirectory = File.ReadAllText(dataPathFile).Trim();
        if (!Path.IsPathFullyQualified(configuredDirectory))
            throw new InvalidDataException($"Enter an absolute folder path in {dataPathFile}.");
        string databaseDirectory = Path.GetFullPath(configuredDirectory);
        string portSettingFile = Path.Combine(dataDirectory, "server-port.txt");
        string portSetting = File.Exists(portSettingFile) ? File.ReadAllText(portSettingFile).Trim() : "auto";
        fixedPort = portSetting != "auto";
        if (fixedPort)
        {
            if (!int.TryParse(portSetting, out port) || port is < 1024 or > 65535)
                throw new InvalidDataException($"Enter a port from 1024 to 65535 in {portSettingFile}.");
            var listener = new TcpListener(IPAddress.Loopback, port);
            try
            {
                listener.Start();
            }
            catch (SocketException)
            {
                throw new InvalidOperationException($"Port {port} is already in use. Choose another port in Server address settings.");
            }
            finally
            {
                listener.Stop();
            }
        }
        else
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
        }
        dashboardUrl = $"http://127.0.0.1:{port}/";

        string bundle = AppContext.BaseDirectory;
        log = new StreamWriter(Path.Combine(dataDirectory, "server.log"), append: true) { AutoFlush = true };
        var start = new ProcessStartInfo(Path.Combine(bundle, "node.exe"))
        {
            WorkingDirectory = Path.Combine(bundle, "app"),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        start.ArgumentList.Add("dist/server/index.js");
        start.Environment["HOST"] = "127.0.0.1";
        start.Environment["PORT"] = port.ToString();
        start.Environment["DATABASE_PATH"] = Path.Combine(databaseDirectory, "dashboards.db");
        start.Environment["DESKTOP_DATA_DIR"] = dataDirectory;
        start.Environment["DESKTOP_PORT_MODE"] = fixedPort ? "fixed" : "auto";
        start.Environment["DESKTOP_LAUNCHER"] = "1";
        server = new Process { StartInfo = start };
        server.OutputDataReceived += (_, args) => WriteLog(args.Data);
        server.ErrorDataReceived += (_, args) => WriteLog(args.Data);
        if (!server.Start()) throw new InvalidOperationException("The server process did not start.");
        server.BeginOutputReadLine();
        server.BeginErrorReadLine();
    }

    private void WriteLog(string? line)
    {
        if (line is null || log is null) return;
        lock (log) log.WriteLine(line);
    }

    private async void CheckServer(object? sender, EventArgs args)
    {
        timer.Stop();
        if (server is null || server.HasExited)
        {
            Fail(fixedPort
                ? $"The server could not start on port {port}. It may already be in use. Check {Path.Combine(dataDirectory, "server.log")}."
                : $"The server stopped. Check {Path.Combine(dataDirectory, "server.log")}");
            return;
        }
        if (!ready)
        {
            if (++attempts > 60)
            {
                Fail($"The server did not start. Check {Path.Combine(dataDirectory, "server.log")}");
                return;
            }
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(1));
                using var response = await client.GetAsync(dashboardUrl + "api/health", timeout.Token);
                if (response.IsSuccessStatusCode)
                {
                    ready = true;
                    File.WriteAllText(sessionFile, port.ToString());
                    OpenDashboard();
                }
            }
            catch (HttpRequestException) { }
            catch (TaskCanceledException) { }
            catch (Exception error)
            {
                Fail($"Could not open PhasePanel: {error.Message}");
                return;
            }
        }
        timer.Start();
    }

    private void OpenDashboard()
    {
        if (dashboardUrl is null) return;
        Process.Start(new ProcessStartInfo(dashboardUrl) { UseShellExecute = true });
    }

    private void Fail(string message)
    {
        MessageBox.Show(message, "PhasePanel", MessageBoxButtons.OK, MessageBoxIcon.Error);
        ExitThread();
    }

    protected override void ExitThreadCore()
    {
        if (closing) return;
        closing = true;
        timer.Stop();
        tray.Visible = false;
        tray.Dispose();
        try
        {
            if (server is { HasExited: false })
            {
                server.StandardInput.Close();
                if (!server.WaitForExit(5000)) server.Kill(entireProcessTree: true);
            }
        }
        catch (InvalidOperationException) { }
        server?.Dispose();
        log?.Dispose();
        client.Dispose();
        try
        {
            if (File.Exists(sessionFile) && File.ReadAllText(sessionFile).Trim() == port.ToString())
                File.Delete(sessionFile);
        }
        catch (IOException) { }
        base.ExitThreadCore();
    }
}
