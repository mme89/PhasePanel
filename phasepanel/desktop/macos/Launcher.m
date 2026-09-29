#import <Cocoa/Cocoa.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

@interface Launcher : NSObject <NSApplicationDelegate>
@property (strong) NSTask *server;
@property (strong) NSStatusItem *statusItem;
@property (strong) NSURL *dashboardURL;
@property BOOL fixedPort;
@property int chosenPort;
@end

@implementation Launcher

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    self.statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSVariableStatusItemLength];
    NSImage *menuIcon = [[NSImage alloc] initWithContentsOfFile:[[NSBundle mainBundle] pathForResource:@"MenuBarIcon" ofType:@"png"]];
    menuIcon.template = YES;
    menuIcon.size = NSMakeSize(20, 20);
    self.statusItem.button.image = menuIcon;
    self.statusItem.button.toolTip = @"PhasePanel";
    NSMenu *menu = [NSMenu new];
    [menu addItemWithTitle:@"Open Dashboard" action:@selector(openDashboard:) keyEquivalent:@"o"].target = self;
    [menu addItemWithTitle:@"Quit PhasePanel" action:@selector(quit:) keyEquivalent:@"q"].target = self;
    self.statusItem.menu = menu;

    NSError *error = nil;
    if (![self startServer:&error]) {
        [self showError:[NSString stringWithFormat:@"Could not start PhasePanel: %@", error.localizedDescription]];
    }
}

- (int)availablePort:(int)requested {
    int descriptor = socket(AF_INET, SOCK_STREAM, 0);
    if (descriptor < 0) return -1;
    struct sockaddr_in address = {0};
    address.sin_len = sizeof(address);
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = htons(requested);
    int result = bind(descriptor, (struct sockaddr *)&address, sizeof(address));
    socklen_t length = sizeof(address);
    if (result == 0) result = getsockname(descriptor, (struct sockaddr *)&address, &length);
    close(descriptor);
    return result == 0 ? ntohs(address.sin_port) : -1;
}

- (BOOL)startServer:(NSError **)error {
    NSURL *resources = [[NSBundle mainBundle] resourceURL];
    NSURL *appDirectory = [resources URLByAppendingPathComponent:@"app" isDirectory:YES];
    NSURL *support = [[[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject URLByAppendingPathComponent:@"PhasePanel" isDirectory:YES];
    if (![[NSFileManager defaultManager] createDirectoryAtURL:support withIntermediateDirectories:YES attributes:nil error:error]) return NO;
    NSURL *dataPathFile = [support URLByAppendingPathComponent:@"data-directory.txt"];
    if (![[NSFileManager defaultManager] fileExistsAtPath:dataPathFile.path] &&
        ![[NSString stringWithFormat:@"%@\n", support.path] writeToURL:dataPathFile atomically:YES encoding:NSUTF8StringEncoding error:error]) return NO;
    NSString *directory = [[NSString stringWithContentsOfURL:dataPathFile encoding:NSUTF8StringEncoding error:error]
        stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (!directory) return NO;
    if (![directory isAbsolutePath]) {
        *error = [NSError errorWithDomain:@"PhasePanel" code:2 userInfo:@{NSLocalizedDescriptionKey:
            [NSString stringWithFormat:@"Enter an absolute folder path in %@.", dataPathFile.path]}];
        return NO;
    }
    NSURL *portSettingURL = [support URLByAppendingPathComponent:@"server-port.txt"];
    NSString *portSetting = @"auto";
    if ([[NSFileManager defaultManager] fileExistsAtPath:portSettingURL.path]) {
        portSetting = [[NSString stringWithContentsOfURL:portSettingURL encoding:NSUTF8StringEncoding error:error]
            stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if (!portSetting) return NO;
    }
    self.fixedPort = ![portSetting isEqualToString:@"auto"];
    int port;
    if (self.fixedPort) {
        NSInteger parsedPort;
        NSScanner *scanner = [NSScanner scannerWithString:portSetting];
        if (![scanner scanInteger:&parsedPort] || !scanner.isAtEnd || parsedPort < 1024 || parsedPort > 65535) {
            *error = [NSError errorWithDomain:@"PhasePanel" code:3 userInfo:@{NSLocalizedDescriptionKey:
                [NSString stringWithFormat:@"Enter a port from 1024 to 65535 in %@.", portSettingURL.path]}];
            return NO;
        }
        port = (int)parsedPort;
        if ([self availablePort:port] < 0) {
            *error = [NSError errorWithDomain:@"PhasePanel" code:4 userInfo:@{NSLocalizedDescriptionKey:
                [NSString stringWithFormat:@"Port %d is already in use. Choose another port in Server address settings.", port]}];
            return NO;
        }
    } else {
        port = [self availablePort:0];
        if (port < 0) {
            *error = [NSError errorWithDomain:@"PhasePanel" code:1 userInfo:@{NSLocalizedDescriptionKey: @"No local port is available."}];
            return NO;
        }
    }
    self.chosenPort = port;

    NSURL *logURL = [support URLByAppendingPathComponent:@"server.log"];
    if (![[NSFileManager defaultManager] fileExistsAtPath:logURL.path]) {
        [[NSFileManager defaultManager] createFileAtPath:logURL.path contents:nil attributes:nil];
    }
    NSFileHandle *log = [NSFileHandle fileHandleForWritingToURL:logURL error:error];
    if (!log) return NO;
    [log seekToEndOfFile];
    self.dashboardURL = [NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%d/", port]];
    self.server = [NSTask new];
    self.server.executableURL = [resources URLByAppendingPathComponent:@"node"];
    self.server.arguments = @[@"dist/server/index.js"];
    self.server.currentDirectoryURL = appDirectory;
    NSMutableDictionary *environment = [NSProcessInfo.processInfo.environment mutableCopy];
    environment[@"HOST"] = @"127.0.0.1";
    environment[@"PORT"] = [NSString stringWithFormat:@"%d", port];
    environment[@"DATABASE_PATH"] = [[directory stringByStandardizingPath] stringByAppendingPathComponent:@"dashboards.db"];
    environment[@"DESKTOP_DATA_DIR"] = support.path;
    environment[@"DESKTOP_PORT_MODE"] = self.fixedPort ? @"fixed" : @"auto";
    [environment removeObjectForKey:@"DESKTOP_LAUNCHER"];
    self.server.environment = environment;
    self.server.standardOutput = log;
    self.server.standardError = log;
    if (![self.server launchAndReturnError:error]) return NO;
    [self waitForServer:0];
    return YES;
}

- (void)waitForServer:(int)attempt {
    if (!self.server.isRunning || attempt >= 60) {
        [self showError:self.fixedPort
            ? [NSString stringWithFormat:@"The server could not start on port %d. It may already be in use. Check server.log in ~/Library/Application Support/PhasePanel.", self.chosenPort]
            : @"The server did not start. Check server.log in ~/Library/Application Support/PhasePanel."];
        return;
    }
    NSURL *health = [self.dashboardURL URLByAppendingPathComponent:@"api/health"];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:health];
    request.timeoutInterval = 1;
    [[[NSURLSession sharedSession] dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if ([(NSHTTPURLResponse *)response statusCode] == 200) {
                [[NSWorkspace sharedWorkspace] openURL:self.dashboardURL];
            } else {
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.25 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                    [self waitForServer:attempt + 1];
                });
            }
        });
    }] resume];
}

- (void)showError:(NSString *)message {
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"PhasePanel";
    alert.informativeText = message;
    [alert runModal];
    [NSApp terminate:nil];
}

- (void)openDashboard:(id)sender { [[NSWorkspace sharedWorkspace] openURL:self.dashboardURL]; }
- (void)quit:(id)sender { [NSApp terminate:nil]; }

- (void)applicationWillTerminate:(NSNotification *)notification {
    if (self.server.isRunning) {
        [self.server terminate];
        [self.server waitUntilExit];
    }
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
        Launcher *launcher = [Launcher new];
        application.delegate = launcher;
        [application run];
    }
    return 0;
}
