import time
from unittest.mock import MagicMock
import numpy as np
import pytest
from controls import OperatorControls
from bridge import preview


def live(now):
    return {"frame":"world", "receivedAt":now*1000}, {"frame":"world", "capturedAt":now*1000}


def test_manual_cancels_planning_and_stops_after_release_deadline():
    app=MagicMock();controls=OperatorControls(app)
    controls.command({"command":"manual","forward":0.4,"yawRate":0,"validUntil":100350},None,None,now=100)
    app.WavefrontFrontierExplorer.end_exploration.assert_called_once()
    app.ReplanningAStarPlanner.cancel_goal.assert_called_once()
    assert app.GO2Connection.move.call_args[0][0].linear.x==0.4
    controls.tick('NavigationState.IDLE',False,now=100.4)
    assert controls.mode=='mapping'
    assert app.GO2Connection.stop_movement.call_count==2


def test_expired_manual_packet_never_moves():
    app=MagicMock();c=OperatorControls(app)
    c.command({"command":"manual","forward":0.4,"yawRate":0,"validUntil":99000},None,None,now=100)
    app.GO2Connection.move.assert_not_called()


@pytest.mark.parametrize('frame,age', [('map',0),('world',10)])
def test_goal_rejects_saved_frames_and_stale_pose(frame,age):
    app=MagicMock();c=OperatorControls(app);pose,cloud=live(100)
    pose['frame']=frame;pose['receivedAt']-=age*1000
    with pytest.raises(ValueError):c.command({'command':'goal','x':2,'y':-1},pose,cloud,now=100)
    app.ReplanningAStarPlanner.set_goal.assert_not_called()


def test_flag_uses_world_xy_and_navigation_reports_no_path():
    app=MagicMock();c=OperatorControls(app);pose,cloud=live(100)
    c.command({'command':'goal','x':2.1,'y':-1.4},pose,cloud,now=100)
    goal=app.ReplanningAStarPlanner.set_goal.call_args[0][0]
    assert (goal.x,goal.y,goal.frame_id)==(2.1,-1.4,'world')
    assert c.mode=='navigating'
    app.ReplanningAStarPlanner.is_goal_reached.return_value=False
    c.tick('NavigationState.IDLE',False,now=101)
    assert 'No usable route' in c.note


def test_dense_preview_retains_world_frame_and_more_than_old_limit():
    cloud=MagicMock(frame_id='world');cloud.points_f32.return_value=np.zeros((65000,3),dtype=np.float32)
    result=preview(cloud)
    assert len(result['points'])==65000
    assert result['totalPoints']==65000 and result['frame']=='world'
    assert len(result['palette'])==256
