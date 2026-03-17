# Fake pycocotools module to appease paddlex imports inside PyInstaller
class COCO:
    pass

class maskUtils:
    pass

import sys
sys.modules['pycocotools.coco'] = sys.modules[__name__]
