# Widar I
(A Helpful Handheld Wifi-Radar)


– Think of a Geiger counter for WIFI, with location and history capabilities

## Summary:
A handheld device that measures signal strength continuously while travelling through a WIFI network distributed across one or multiple routers. The device would be configured to test a specific WIFI channel's coverage.  Any measurements found would be stored on the handheld device on an SSD card (or similar memory device) and synced to a remote server.
A web API would allow measurements to be viewed as a heatmap to indicate signal strength
Applications

### Potential Uses: 
Help network admins identify weak spots in wifi coverage for signal booster placement.

### Widar vs Existing Software
While WiFi heatmap technologies already exist (such as this optimized wireless network mapper), Widar is unique in that it uses live data. Existing market solutions rely on digital models of buildings for approximating coverage. It would be costly for non-profit organizations to design industry-grade models just to test their WiFi! Widar solves this by generating the floorplan itself through advanced laser scanning technology.

### Questions This IoT Could Help Answer
- How does building material affect wifi signal propagation?
- How does building geometry affect wifi signal propagation?
- What is the ideal placement pattern for wifi routers?


## Required Features and Technology:
### Feature I: Where am I? (Scanning & Mapping)
- (Simultaneous Localization and Mapping) SLAM

    - Small portable computer capable of running hector_slam 2D via the ROS melodic operating system (based on Ubuntu 18)
        * “Unlike traditional grid-based methods (like Gmapping) that rely heavily on a robot's wheel odometry, Hector SLAM relies purely on fast LiDAR scan matching at the full update rate of the sensor.” (Hector SLAM)
Handheld Mapping System in the RoboCup 2011 Rescue Arena
Hector SLAM recommends 4GB of RAM for ideal operation
- SLAM technology uses LiDAR to identify planar surfaces and construct a mapping:

![2D map](SlamMap.png)
*2D obstacle map generated with hector_slam*
- Why not GPS?
    - GPS uses line-of-site triangulation. GPS cannot work indoors and has a high margin of error (+/- 30 feet) 
    * GPS supplies only a location, it cannot generate a collision map. A pre-fabricated floorplan map would be required.

### Feature II: Where have I been? (Data Storage)
* Hector SLAM and Wifi scanner saves the scan to an SD card
    * 32GB recommended for large areas
    * Data Collected:
        * SLAM 2D scan of mapped area (.pgm)
        * Trace of path taken by Widar operator (???)
        * Wifi strength datapoints (.csv)
Transfer SD to laptop for upload or upload directly from Widar.



### Feature III: Where is the WiFi good? (Data Analysis)
* WiFi card continuously monitors signal strength as 2D points.
* Each point relates to a location in SLAM map
* Adjustable sampling rate: more precise heatmap -> larger scan files

### Feature IV: What does WiFi look like? (User-Friendly Visualization)
* Sync data to a remote webserver which generates and hosts interactive WiFi map.
* Using HeatMapper 2 API to generate a heatmap from the discretized WiFi points.
![2D HeatMap](heatmap.png)
*A simulated wifi heatmap. Unlike Widar I which gathers live data, a simulated heatmap generates a prediction based on digital floor layouts.*
* Use SVG.js with the floorplan scan to display a clean, easy to navigate map for frontend Web.
* Use hotspot algorithms to identify areas of high/low connectivity.


