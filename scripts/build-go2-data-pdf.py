"""Build the short, static summary of the November 2026 Go2 Pro probes.

Run with a Python environment containing reportlab. Does not connect to the robot.
"""
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output/pdf/go2-pro-data-summary.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
NAVY = colors.HexColor("#142C43")
TEAL = colors.HexColor("#007E80")
GRAY = colors.HexColor("#526476")
PALE = colors.HexColor("#ECF5F5")
RULE = colors.HexColor("#D7E1E8")
styles = getSampleStyleSheet()
styles.add(ParagraphStyle("TitleGo", fontName="Helvetica-Bold", fontSize=26,
                          leading=30, textColor=NAVY, spaceAfter=9))
styles.add(ParagraphStyle("SubGo", fontSize=10, leading=14, textColor=GRAY,
                          spaceAfter=16))
styles.add(ParagraphStyle("HGo", fontName="Helvetica-Bold", fontSize=12,
                          leading=16, textColor=TEAL, spaceBefore=13, spaceAfter=7))
styles.add(ParagraphStyle("BodyGo", fontSize=9.5, leading=13.5,
                          textColor=NAVY, spaceAfter=8))
styles.add(ParagraphStyle("CellGo", fontSize=8.3, leading=11.3, textColor=NAVY))
styles.add(ParagraphStyle("SmallGo", fontSize=8, leading=11, textColor=GRAY,
                          spaceAfter=6))
styles.add(ParagraphStyle("CodeGo", fontName="Courier", fontSize=8.1, leading=12,
                          textColor=NAVY, backColor=PALE, borderPadding=9,
                          spaceBefore=4, spaceAfter=10))


def p(text, style="BodyGo"):
    return Paragraph(text, styles[style])


def table(headers, rows, widths):
    cells = [[p(f"<b>{escape(t)}</b>", "CellGo") for t in headers]]
    cells += [[p(escape(str(t)), "CellGo") for t in row] for row in rows]
    t = Table(cells, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PALE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, RULE),
        ("LINEBELOW", (0, 1), (-1, -1), 0.35, RULE),
    ]))
    return t


def footer(canvas, doc):
    canvas.saveState()
    w, _ = doc.pagesize
    canvas.setStrokeColor(RULE)
    canvas.line(44, 40, w - 44, 40)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(GRAY)
    canvas.drawString(44, 27, "GO2 POCKET  |  Verified 2026-11-06  |  Local WebRTC")
    canvas.drawRightString(w - 44, 27, f"{doc.page} / 2")
    canvas.restoreState()


story = [
    p("What your Go2 Pro can share", "TitleGo"),
    p("Confirmed on your robot via authenticated WebRTC over Wi-Fi.<br/>"
      "Firmware 1.1.15 | LiDAR software 1.0.0.38 | Mac client", "SubGo"),
    p("Available now", "HGo"),
    table(["Data", "What we received", "Condition / delivery"], [
        ("Position + attitude", "XYZ position; quaternion; roll, pitch and yaw", "Idle: about 19-20 Hz"),
        ("Motion + IMU", "XYZ velocity, turn rate, body height, gyro and acceleration", "Idle: about 20 Hz"),
        ("Live 3D surroundings", "Compressed voxel geometry in odom; 5 cm cells", "Idle: about 8 Hz"),
        ("LiDAR diagnostics", "Scan statistics, error/dirt status, internal IMU statistics", "Idle: about 5 Hz"),
        ("Mapping", "World cloud plus timestamped odometry", "Confirmed while mapping"),
        ("Localization", "Localized pose and XYZ/intensity point cloud", "Initialization succeeded"),
        ("Saved map", "PCD points + PGM grid + TXT metadata downloaded", "Static-file transfer worked"),
        ("Other telemetry", "Joint angles, foot forces, battery/power; camera and audio", "Telemetry/media available"),
    ], [113, 253, 158]),
    p("Three services activated successfully", "HGo"),
    p("<b>Mapping:</b> active status and cloud data. <b>Localization:</b> successful "
      "initialization and localized pose. <b>Navigation:</b> active and WAITING; "
      "no goal was sent. All three were stopped after the test."),
    p("What this enables", "HGo"),
    p("A live room display and a practical onboard mapping/localization path toward "
      "marking anchor A and returning to it. Autonomous return, complete room "
      "coverage and map reuse after restart still need validation."),
    p("Rates are short-test message delivery rates, not hardware guarantees. "
      "Position is a local estimate, not GPS or a permanent surveyed room location.", "SmallGo"),
    PageBreak(),
    p("How to access it", "TitleGo"),
    p("Exact setup, payloads and decoders: docs/go2-pro-data-access.md<br/>"
      "Full investigation and evidence: docs/go2-pro-data.md", "SubGo"),
    p("Read-only probe on the Mac", "HGo"),
    p("Use the existing .env robot IP, robot ID and AES key. Keep the robot and Mac "
      "on the same local Wi-Fi network; Chrome and project dependencies are required."),
    p("npm run dev<br/>"
      "# In a second terminal at the repo root:<br/>"
      "node integrations/point-lio/inspect-webrtc.mjs", "CodeGo"),
    p("Vite must run on port 5186. The probe writes a private sensor-report.json "
      "under output/point-lio/inspection/. Default mode starts no robot services. "
      "Reports preserve field samples and byte counts, not full binary recordings.", "SmallGo"),
    table(["Subscribe to", "Receive"], [
        ("rt/lf/sportmodestate", "IMU, position, velocity, turning and gait"),
        ("rt/utlidar/robot_pose", "Timestamped local position/orientation"),
        ("rt/utlidar/voxel_map_compressed", "Nearby 3D voxel geometry"),
        ("rt/uslam/frontend/odom + cloud_world_ds", "Mapping pose/cloud (both under rt/uslam/frontend/)"),
        ("rt/uslam/localization/odom + cloud_world", "Localized pose/cloud (both under rt/uslam/localization/)"),
    ], [293, 231]),
    p("Activation changes the robot", "HGo"),
    p("Commands go to <b>rt/uslam/client_command</b>; events arrive on "
      "<b>rt/uslam/server_log</b>. Start/stop mapping first, then wait for localization "
      "initialization before navigation. Follow the detailed guide for exact sequencing."),
    p("<b>Important observed effects:</b> mapping/navigation startup can trigger "
      "STAND_UP. New mapping overwrites the robot's single map slot. The prior map "
      "was backed up locally; the robot currently holds the short test map."),
    p("What is not established", "HGo"),
    p("Timed raw LiDAR scans were not received. The confirmed localization cloud "
      "has XYZ/intensity but no per-point time field. Mac Point-LIO works on a sample "
      "recording; live Point-LIO, generated navigation paths, obstacle handling and "
      "return-to-A remain unverified."),
    p("Evidence: local activation report, sensor reports and map backup. "
      'Protocol sources: <link href="https://github.com/legion1581/unitree_webrtc_connect" color="#007E80">'
      'WebRTC driver</link>; '
      '<link href="https://github.com/unitreerobotics/unitree_ros2" color="#007E80">'
      'Unitree message schemas</link>. No jailbreak, firmware changes or SSH used.', "SmallGo"),
]

doc = SimpleDocTemplate(str(OUTPUT), pagesize=(612, 792),
                        leftMargin=44, rightMargin=44, topMargin=39, bottomMargin=54,
                        title="Go2 Pro - Available data over WebRTC",
                        author="Go2 Pocket", subject="Verified robot data and access summary")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUTPUT)
