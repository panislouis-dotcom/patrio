from dataclasses import dataclass, field
import time


@dataclass
class SignalRaw:
    portal: str
    url: str
    title: str
    address: str = ''
    city: str = 'Monterrey'
    price: float = 0.0
    sqm_land: float = 0.0


class PortalUnavailable(Exception):
    pass


def rate_limit(secs: float = 1.0):
    time.sleep(secs)
