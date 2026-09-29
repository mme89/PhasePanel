#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>

static void renderIcon(NSString *path, size_t pixels, BOOL menuBar) {
    CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(NULL, pixels, pixels, 8, 0, colorSpace, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
    CGColorSpaceRelease(colorSpace);
    CGContextSetAllowsAntialiasing(context, true);
    CGContextSetShouldAntialias(context, true);
    CGContextScaleCTM(context, (CGFloat)pixels / 40.0, (CGFloat)pixels / 40.0);
    CGContextTranslateCTM(context, 0, 40);
    CGContextScaleCTM(context, 1, -1);

    if (!menuBar) {
        CGPathRef background = CGPathCreateWithRoundedRect(CGRectMake(0, 0, 40, 40), 10, 10, NULL);
        CGContextSetRGBFillColor(context, 23.0 / 255.0, 60.0 / 255.0, 48.0 / 255.0, 1);
        CGContextAddPath(context, background);
        CGContextFillPath(context);
        CGPathRelease(background);
    }

    CGContextBeginPath(context);
    CGContextMoveToPoint(context, 23, 7);
    CGContextAddLineToPoint(context, 11, 22);
    CGContextAddLineToPoint(context, 19, 22);
    CGContextAddLineToPoint(context, 17, 33);
    CGContextAddLineToPoint(context, 30, 16);
    CGContextAddLineToPoint(context, 21, 16);
    CGContextClosePath(context);
    if (menuBar) CGContextSetRGBFillColor(context, 0, 0, 0, 1);
    else CGContextSetRGBFillColor(context, 184.0 / 255.0, 236.0 / 255.0, 130.0 / 255.0, 1);
    CGContextFillPath(context);

    CGImageRef image = CGBitmapContextCreateImage(context);
    CGContextRelease(context);
    CGImageDestinationRef destination = CGImageDestinationCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:path], CFSTR("public.png"), 1, NULL);
    CGImageDestinationAddImage(destination, image, NULL);
    if (!CGImageDestinationFinalize(destination)) {
        fprintf(stderr, "Could not write icon: %s\n", path.UTF8String);
        exit(1);
    }
    CFRelease(destination);
    CGImageRelease(image);
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 4) {
            fprintf(stderr, "Usage: IconRenderer output.png pixels app|menu\n");
            return 1;
        }
        renderIcon([NSString stringWithUTF8String:argv[1]], (size_t)atoi(argv[2]), strcmp(argv[3], "menu") == 0);
    }
    return 0;
}
