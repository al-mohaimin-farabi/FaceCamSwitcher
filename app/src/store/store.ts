import { configureStore } from "@reduxjs/toolkit";
import observerReducer from "./observerSlice";

export const store = configureStore({
  reducer: {
    observer: observerReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
