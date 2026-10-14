/**
 * NativeWind solo agrega `className` a los componentes de React Native. Los
 * de otras librerías hay que registrarlos acá para poder usar clases en ellos.
 */

import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import Animated from 'react-native-reanimated';

cssInterop(BlurView, { className: 'style' });
cssInterop(LinearGradient, { className: 'style' });
// Sin esto, un `className` en un Animated.View (entering/exiting) se ignora.
cssInterop(Animated.View, { className: 'style' });
